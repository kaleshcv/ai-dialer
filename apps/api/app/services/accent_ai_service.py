from __future__ import annotations

import base64
import json
import os
import shutil
import signal
import subprocess
import threading
from math import gcd
from pathlib import Path

import numpy as np
from fastapi import HTTPException, WebSocket, status
from starlette.websockets import WebSocketDisconnect
from scipy.signal import resample_poly

from app.core.config import settings


def _decode_pcm_base64(value: str) -> np.ndarray:
    try:
        raw = base64.b64decode(value)
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail='Invalid base64 audio payload') from exc
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def _decode_pcm_bytes(value: bytes) -> np.ndarray:
    return np.frombuffer(value, dtype=np.int16).astype(np.float32) / 32768.0


def _encode_pcm_base64(value: np.ndarray) -> str:
    clipped = np.clip(value, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype(np.int16)
    return base64.b64encode(pcm.tobytes()).decode('utf-8')


def _encode_pcm_bytes(value: np.ndarray) -> bytes:
    clipped = np.clip(value, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype(np.int16)
    return pcm.tobytes()


def _resample_audio(audio: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    if source_rate == target_rate or audio.size == 0:
        return audio.astype(np.float32, copy=False)

    factor = gcd(source_rate, target_rate)
    up = target_rate // factor
    down = source_rate // factor
    return resample_poly(audio, up, down).astype(np.float32, copy=False)


def _normalize_audio_label(value: str) -> str:
    return ' '.join(str(value or '').strip().lower().split())


def _list_pactl_json(kind: str) -> list[dict]:
    if not shutil.which('pactl'):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='pactl is required to manage Linux audio defaults.',
        )

    completed = subprocess.run(
        ['pactl', '-f', 'json', 'list', kind],
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(completed.stderr or completed.stdout or f'Could not list PulseAudio {kind}.').strip(),
        )

    try:
        payload = json.loads(completed.stdout or '[]')
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f'Could not parse PulseAudio {kind} metadata.',
        ) from exc

    return payload if isinstance(payload, list) else []


def _score_audio_device_match(entry: dict, target_label: str) -> int:
    normalized_target = _normalize_audio_label(target_label)
    if not normalized_target:
        return -1

    properties = entry.get('properties') or {}
    description = _normalize_audio_label(entry.get('description') or '')
    device_description = _normalize_audio_label(properties.get('device.description') or '')
    alias = _normalize_audio_label(properties.get('bluez.alias') or '')
    card_name = _normalize_audio_label(properties.get('alsa.card_name') or '')
    name = _normalize_audio_label(entry.get('name') or '')
    candidates = [description, device_description, alias, card_name, name]

    best_score = -1
    for candidate in candidates:
      if not candidate:
        continue
      if candidate == normalized_target:
        best_score = max(best_score, 100)
      elif normalized_target in candidate:
        best_score = max(best_score, 80)
      elif candidate in normalized_target:
        best_score = max(best_score, 60)

    return best_score


def _find_best_audio_device(kind: str, target_label: str) -> dict:
    entries = _list_pactl_json(kind)
    filtered_entries = []
    for entry in entries:
        name = str(entry.get('name') or '')
        description = str(entry.get('description') or '')
        if settings.ACCENTAI_HOST_OUTPUT_NAME in name or settings.ACCENTAI_HOST_OUTPUT_NAME in description:
            continue
        if kind == 'sources' and (name.endswith('.monitor') or 'Monitor of' in description):
            continue
        filtered_entries.append(entry)

    ranked_entries = sorted(
        filtered_entries,
        key=lambda entry: _score_audio_device_match(entry, target_label),
        reverse=True,
    )
    best_entry = ranked_entries[0] if ranked_entries else None
    best_score = _score_audio_device_match(best_entry or {}, target_label)
    if not best_entry or best_score < 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f'Could not match Linux audio {kind[:-1]} for "{target_label}".',
        )

    return best_entry


def set_linux_audio_defaults(*, input_label: str, output_label: str) -> dict:
    source_entry = _find_best_audio_device('sources', input_label)
    sink_entry = _find_best_audio_device('sinks', output_label)

    for command in (
        ['pactl', 'set-default-source', str(source_entry.get('name') or '')],
        ['pactl', 'set-default-sink', str(sink_entry.get('name') or '')],
    ):
        completed = subprocess.run(command, capture_output=True, text=True)
        if completed.returncode != 0:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(completed.stderr or completed.stdout or f'Failed to run {" ".join(command)}').strip(),
            )

    return {
        'status': 'ok',
        'default_source': str(source_entry.get('name') or ''),
        'default_source_label': str(source_entry.get('description') or ''),
        'default_sink': str(sink_entry.get('name') or ''),
        'default_sink_label': str(sink_entry.get('description') or ''),
    }


def _normalize_audio_level(audio: np.ndarray, target_peak: float = 0.92) -> np.ndarray:
    if audio.size == 0:
        return audio
    peak = float(np.max(np.abs(audio)))
    if peak < 1e-4:
        return audio
    gain = min(target_peak / peak, 6.0)
    return np.clip(audio * gain, -1.0, 1.0).astype(np.float32, copy=False)


def _condition_input_audio(audio: np.ndarray) -> np.ndarray:
    if audio.size == 0:
        return audio.astype(np.float32, copy=False)

    conditioned = audio.astype(np.float32, copy=True)

    # Remove DC bias so the DSP sees a centered waveform.
    conditioned -= np.mean(conditioned, dtype=np.float32)

    rms = float(np.sqrt(np.mean(np.square(conditioned), dtype=np.float32)))
    if rms > 1e-5:
        target_rms = 0.08
        gain = min(target_rms / rms, 2.0)
        conditioned *= gain

    return np.clip(conditioned, -1.0, 1.0).astype(np.float32, copy=False)


def _polish_output_audio(audio: np.ndarray) -> np.ndarray:
    if audio.size == 0:
        return audio.astype(np.float32, copy=False)

    return _normalize_audio_level(audio.astype(np.float32, copy=False), target_peak=0.82)


class AccentAiDspSession:
    def __init__(self):
        self._lock = threading.Lock()
        self._process = self._start_process()
        self._dsp_input_remainder = np.zeros(0, dtype=np.float32)
        self._input_resample_history = np.zeros(0, dtype=np.float32)
        self._output_resample_history = np.zeros(0, dtype=np.float32)

    def _start_process(self) -> subprocess.Popen[bytes]:
        node_bin = shutil.which(settings.ACCENTAI_DSP_NODE_BIN) or settings.ACCENTAI_DSP_NODE_BIN
        dsp_root = Path(settings.ACCENTAI_DSP_ROOT)
        script_path = Path(settings.ACCENTAI_DSP_SCRIPT)
        try:
            return subprocess.Popen(
                [node_bin, str(script_path)],
                cwd=str(dsp_root),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                bufsize=0,
            )
        except FileNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f'AccentAI DSP node runtime is not available: {settings.ACCENTAI_DSP_NODE_BIN}',
            ) from exc

    def _read_exact(self, process: subprocess.Popen[bytes], size: int) -> bytes:
        if not process.stdout:
            return b''
        chunks = bytearray()
        stdout_fd = process.stdout.fileno()
        while len(chunks) < size:
            chunk = os.read(stdout_fd, size - len(chunks))
            if not chunk:
                break
            chunks.extend(chunk)
        return bytes(chunks)

    def close(self) -> None:
        with self._lock:
            process = self._process
            self._process = None
            if not process:
                return
            try:
                if process.stdin:
                    process.stdin.close()
            except Exception:
                pass
            try:
                if process.stdout:
                    process.stdout.close()
            except Exception:
                pass
            try:
                if process.stderr:
                    process.stderr.close()
            except Exception:
                pass
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()

    def _resample_with_history(
        self,
        audio: np.ndarray,
        source_rate: int,
        target_rate: int,
        *,
        history_attr: str,
        history_duration_seconds: float = 0.008,
    ) -> np.ndarray:
        if source_rate == target_rate or audio.size == 0:
            return audio.astype(np.float32, copy=False)

        history = getattr(self, history_attr)
        history_samples = max(32, int(round(source_rate * history_duration_seconds)))
        if history.size:
            merged = np.concatenate((history, audio), dtype=np.float32)
            discard_samples = int(round(history.size * target_rate / source_rate))
        else:
            merged = audio.astype(np.float32, copy=False)
            discard_samples = 0

        resampled = _resample_audio(merged, source_rate, target_rate)
        if discard_samples > 0:
            if discard_samples >= resampled.size:
                resampled = np.zeros(0, dtype=np.float32)
            else:
                resampled = resampled[discard_samples:]

        next_history = merged[-history_samples:] if merged.size > history_samples else merged
        setattr(self, history_attr, next_history.astype(np.float32, copy=False))
        return resampled.astype(np.float32, copy=False)

    def process_audio(
        self,
        audio: np.ndarray,
        sample_rate: int,
        *,
        apply_input_conditioning: bool = True,
        apply_output_polish: bool = True,
    ) -> tuple[np.ndarray, int]:
        if audio.size == 0:
            return audio.astype(np.float32, copy=False), sample_rate

        packet_samples = settings.ACCENTAI_DSP_PACKET_SAMPLES
        dsp_sample_rate = settings.ACCENTAI_DSP_SAMPLE_RATE
        prepared_input = _condition_input_audio(audio) if apply_input_conditioning else audio.astype(np.float32, copy=False)
        dsp_audio = self._resample_with_history(
            prepared_input,
            sample_rate,
            dsp_sample_rate,
            history_attr='_input_resample_history',
        )
        if self._dsp_input_remainder.size:
            dsp_audio = np.concatenate((self._dsp_input_remainder, dsp_audio), dtype=np.float32)
        process_length = (dsp_audio.size // packet_samples) * packet_samples
        if process_length == 0:
            self._dsp_input_remainder = dsp_audio
            return np.zeros(0, dtype=np.float32), sample_rate

        self._dsp_input_remainder = dsp_audio[process_length:].astype(np.float32, copy=False)
        dsp_audio = dsp_audio[:process_length]
        pcm_packets = (np.clip(dsp_audio, -1.0, 1.0) * 32767.0).astype(np.int16, copy=False)

        with self._lock:
            process = self._process
            if not process or process.poll() is not None or not process.stdin or not process.stdout:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail='AccentAI DSP process is not running.',
                )

            output_chunks: list[np.ndarray] = []
            bytes_per_packet = packet_samples * 4
            try:
                for index in range(0, pcm_packets.size, packet_samples):
                    packet = pcm_packets[index : index + packet_samples]
                    process.stdin.write(packet.tobytes())
                    raw = self._read_exact(process, bytes_per_packet)
                    if len(raw) != bytes_per_packet:
                        raise HTTPException(
                            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail='AccentAI DSP returned incomplete audio.',
                        )
                    output_chunks.append(np.frombuffer(raw, dtype=np.float32).copy())
            except BrokenPipeError as exc:
                self.close()
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail='AccentAI DSP process terminated while converting audio.',
                ) from exc

        dsp_output = np.concatenate(output_chunks, dtype=np.float32)
        output = self._resample_with_history(
            dsp_output,
            dsp_sample_rate,
            sample_rate,
            history_attr='_output_resample_history',
        )
        if apply_output_polish:
            output = _polish_output_audio(output)
        return output.astype(np.float32, copy=False), sample_rate


class AccentAiManager:
    def __init__(self):
        self._lock = threading.Lock()
        self._sessions: dict[str, AccentAiDspSession] = {}
        self._idle_session: AccentAiDspSession | None = None
        self._warmup_started = False
        self._warmup_thread: threading.Thread | None = None
        self._service_enabled = True
        self._ensure_idle_session_async()

    def _host_pid_file(self) -> Path:
        return Path(settings.ACCENTAI_HOST_PID_FILE)

    def _host_log_file(self) -> Path:
        return Path(settings.ACCENTAI_HOST_LOG_FILE)

    def _host_setup_script(self) -> Path:
        return Path(settings.ACCENTAI_HOST_SETUP_SCRIPT)

    def _host_start_script(self) -> Path:
        return Path(settings.ACCENTAI_HOST_START_SCRIPT)

    def _host_stop_script(self) -> Path:
        return Path(settings.ACCENTAI_HOST_STOP_SCRIPT)

    def _host_audio_ready(self) -> bool:
        if not shutil.which('pactl'):
            return False
        try:
            result = subprocess.run(
                ['pactl', 'list', 'short', 'sources'],
                capture_output=True,
                text=True,
                check=True,
            )
        except Exception:
            return False
        source_name = settings.ACCENTAI_HOST_OUTPUT_NAME.lower()
        return source_name in result.stdout.lower() or f'monitor of {source_name}' in result.stdout.lower()

    def _host_service_running(self) -> bool:
        pid_file = self._host_pid_file()
        if not pid_file.exists():
            return False
        try:
            pid = int(pid_file.read_text().strip())
        except Exception:
            return False
        try:
            os.kill(pid, 0)
        except OSError:
            return False
        return True

    def _run_host_script(self, script_path: Path) -> None:
        if not script_path.exists():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f'AccentAI host control script is missing: {script_path}',
            )
        env = os.environ.copy()
        env['ACCENTAI_HOST_OUTPUT_NAME'] = settings.ACCENTAI_HOST_OUTPUT_NAME
        env['ACCENTAI_HOST_PID_FILE'] = settings.ACCENTAI_HOST_PID_FILE
        env['ACCENTAI_HOST_LOG_FILE'] = settings.ACCENTAI_HOST_LOG_FILE
        env['ACCENTAI_HOST_SETUP_SCRIPT'] = settings.ACCENTAI_HOST_SETUP_SCRIPT
        env['ACCENTAI_DIR'] = str(Path(settings.ACCENTAI_DSP_ROOT))
        completed = subprocess.run(
            [str(script_path)],
            env=env,
            capture_output=True,
            text=True,
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or '').strip()
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=detail or f'AccentAI host control failed via {script_path.name}.',
            )

    def _start_host_pipeline(self) -> dict:
        with self._lock:
            self._service_enabled = True
        self._run_host_script(self._host_setup_script())
        self._run_host_script(self._host_start_script())
        self._ensure_idle_session_async()
        return {'status': 'ok', 'running': self._host_service_running()}

    def _stop_host_pipeline(self) -> dict:
        with self._lock:
            self._service_enabled = False
            idle_session = self._idle_session
            self._idle_session = None
            sessions = list(self._sessions.values())
            self._sessions.clear()
        if idle_session is not None:
            idle_session.close()
        for session in sessions:
            session.close()
        try:
            self._run_host_script(self._host_stop_script())
        except HTTPException:
            pass
        return {'status': 'ok', 'running': False}

    def _ensure_idle_session_async(self) -> None:
        with self._lock:
            if not self._service_enabled or self._idle_session is not None or self._warmup_started:
                return
            self._warmup_started = True

        def warmup() -> None:
            try:
                self._ensure_ready()
                session = AccentAiDspSession()
                with self._lock:
                    if self._idle_session is None:
                        self._idle_session = session
                        session = None
                if session is not None:
                    session.close()
            except Exception:
                pass
            finally:
                with self._lock:
                    self._warmup_started = False

        thread = threading.Thread(target=warmup, name='accentai-dsp-warmup', daemon=True)
        self._warmup_thread = thread
        thread.start()

    def _required_files(self) -> dict[str, Path]:
        return {
            'dsp_root': Path(settings.ACCENTAI_DSP_ROOT),
            'dsp_script': Path(settings.ACCENTAI_DSP_SCRIPT),
            'dsp_bundle': Path(settings.ACCENTAI_DSP_BUNDLE),
            'dsp_wasm': Path(settings.ACCENTAI_DSP_WASM),
            'dsp_model': Path(settings.ACCENTAI_DSP_MODEL),
        }

    def _required_runtime_paths(self) -> list[Path]:
        required_files = self._required_files()
        runtime_paths = [
            required_files['dsp_root'],
            required_files['dsp_script'],
        ]
        bundle_path = required_files['dsp_bundle']
        wasm_path = required_files['dsp_wasm']
        model_path = required_files['dsp_model']
        if bundle_path.exists() or (wasm_path.exists() and model_path.exists()):
            runtime_paths.append(bundle_path if bundle_path.exists() else wasm_path)
            if not bundle_path.exists():
                runtime_paths.append(model_path)
        else:
            runtime_paths.extend([bundle_path, wasm_path, model_path])
        return runtime_paths

    def _node_runtime_ready(self) -> bool:
        return bool(shutil.which(settings.ACCENTAI_DSP_NODE_BIN))

    def _ensure_ready(self) -> None:
        if not self._service_enabled:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail='AccentAI service is stopped.',
            )
        missing = [str(path) for path in self._required_runtime_paths() if not path.exists()]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f'AccentAI DSP assets are not ready. Missing: {", ".join(missing)}',
            )
        if not self._node_runtime_ready():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f'AccentAI DSP requires a Node runtime named "{settings.ACCENTAI_DSP_NODE_BIN}" in PATH.',
            )

    def _get_or_create_session(self, session_id: str) -> AccentAiDspSession:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is not None:
                return session
            self._ensure_ready()
            session = self._idle_session
            self._idle_session = None
            if session is None:
                session = AccentAiDspSession()
            self._sessions[session_id] = session
        self._ensure_idle_session_async()
        return session

    def info(self) -> dict:
        required_files = self._required_files()
        host_scripts_ready = (
            self._host_setup_script().exists()
            and self._host_start_script().exists()
            and self._host_stop_script().exists()
        )
        bundle_ready = required_files['dsp_bundle'].exists()
        split_assets_ready = required_files['dsp_wasm'].exists() and required_files['dsp_model'].exists()
        ready = (
            self._node_runtime_ready()
            and required_files['dsp_root'].exists()
            and required_files['dsp_script'].exists()
            and (bundle_ready or split_assets_ready)
            and host_scripts_ready
        )
        if ready:
            self._ensure_idle_session_async()
        return {
            'status': 'ok',
            'backend': 'accentai-dsp',
            'ready': ready,
            'model_root': str(Path(settings.ACCENTAI_DSP_ROOT)),
            'available_languages': ['en-US'],
            'pipeline': 'control_only_converted_mic_source',
            'control_mode': 'device-control',
            'service_enabled': self._service_enabled,
            'host_pipeline_enabled': host_scripts_ready,
            'host_pipeline_running': self._host_service_running(),
            'host_audio_ready': self._host_audio_ready(),
            'asr_model': None,
            'tts_model': None,
            'tts_sample_rate': settings.ACCENTAI_DSP_SAMPLE_RATE,
            'dsp_sample_rate': settings.ACCENTAI_DSP_SAMPLE_RATE,
            'dsp_packet_samples': settings.ACCENTAI_DSP_PACKET_SAMPLES,
            'dsp_assets_mode': 'bundle' if bundle_ready else ('split' if split_assets_ready else 'missing'),
            'required_files': {
                **{key: str(path) for key, path in required_files.items()},
                'host_start_script': str(self._host_start_script()),
                'host_stop_script': str(self._host_stop_script()),
                'host_setup_script': str(self._host_setup_script()),
                'host_pid_file': str(self._host_pid_file()),
                'host_log_file': str(self._host_log_file()),
            },
        }

    def reset(self, session_id: str) -> dict:
        with self._lock:
            session = self._sessions.pop(session_id, None)
            if session is not None and self._idle_session is None:
                self._idle_session = session
                session = None
        if session is not None:
            session.close()
        self._ensure_idle_session_async()
        return {
            'status': 'ok',
            'session_id': session_id,
        }

    def process_chunk(
        self,
        *,
        session_id: str,
        sample_rate: int,
        buffer: str | bytes,
        apply_input_conditioning: bool = True,
        apply_output_polish: bool = True,
    ) -> dict:
        audio = _decode_pcm_bytes(buffer) if isinstance(buffer, bytes) else _decode_pcm_base64(buffer)
        if audio.size == 0:
            return {
                'transcript': '',
                'audio': '',
                'audio_bytes': b'',
                'audio_sample_rate': sample_rate,
            }

        session = self._get_or_create_session(session_id)
        output_audio, output_sample_rate = session.process_audio(
            audio,
            sample_rate,
            apply_input_conditioning=apply_input_conditioning,
            apply_output_polish=apply_output_polish,
        )
        return {
            'transcript': 'Direct audio conversion',
            'audio': _encode_pcm_base64(output_audio),
            'audio_bytes': _encode_pcm_bytes(output_audio),
            'audio_sample_rate': output_sample_rate,
        }

    async def websocket_session(self, websocket: WebSocket) -> None:
        await websocket.accept()
        active_session_id = ''
        active_sample_rate = settings.ACCENTAI_DSP_SAMPLE_RATE
        active_apply_input_conditioning = True
        active_apply_output_polish = True
        try:
            await websocket.send_json({'type': 'ready', **self.info()})
            while True:
                message = await websocket.receive()
                if message.get('type') == 'websocket.disconnect':
                    break

                if 'text' in message and message['text'] is not None:
                    payload = json.loads(message['text'])
                    event_type = str(payload.get('type') or '').strip().lower()

                    if event_type == 'ping':
                        await websocket.send_json({'type': 'pong'})
                        continue

                    if event_type == 'start':
                        session_id = str(payload.get('session_id') or '').strip()
                        if not session_id:
                            await websocket.send_json({'type': 'error', 'detail': 'AccentAI start event requires session_id.'})
                            continue
                        active_sample_rate = int(payload.get('sample_rate') or settings.ACCENTAI_DSP_SAMPLE_RATE)
                        active_apply_input_conditioning = bool(payload.get('apply_input_conditioning', True))
                        active_apply_output_polish = bool(payload.get('apply_output_polish', True))
                        self._get_or_create_session(session_id)
                        active_session_id = session_id
                        await websocket.send_json({'type': 'started', **self.info(), 'session_id': session_id})
                        continue

                    if event_type == 'reset':
                        session_id = str(payload.get('session_id') or active_session_id or '').strip()
                        await websocket.send_json({'type': 'reset', **self.reset(session_id)})
                        if session_id == active_session_id:
                            active_session_id = ''
                        continue

                    await websocket.send_json({'type': 'error', 'detail': f'Unsupported AccentAI event: {event_type or "unknown"}'})
                    continue

                if 'bytes' not in message or message['bytes'] is None:
                    continue

                if not active_session_id:
                    await websocket.send_json({'type': 'error', 'detail': 'AccentAI audio stream started before session initialization.'})
                    continue

                try:
                    result = self.process_chunk(
                        session_id=active_session_id,
                        sample_rate=active_sample_rate,
                        buffer=message['bytes'],
                        apply_input_conditioning=active_apply_input_conditioning,
                        apply_output_polish=active_apply_output_polish,
                    )
                except HTTPException as exc:
                    await websocket.send_json({'type': 'error', 'detail': str(exc.detail)})
                    continue
                except Exception as exc:  # pragma: no cover - runtime protection
                    await websocket.send_json({'type': 'error', 'detail': f'AccentAI processing failed: {exc}'})
                    continue

                if result['audio_bytes']:
                    await websocket.send_bytes(result['audio_bytes'])
        except WebSocketDisconnect:
            pass
        finally:
            if active_session_id:
                self.reset(active_session_id)
            try:
                await websocket.close()
            except Exception:
                pass


_manager = AccentAiManager()


def get_accent_ai_info() -> dict:
    return _manager.info()


def reset_accent_ai_session(session_id: str) -> dict:
    return _manager.reset(session_id)


async def handle_accent_ai_websocket(websocket: WebSocket) -> None:
    await _manager.websocket_session(websocket)


def start_accent_ai_host_pipeline() -> dict:
    return _manager._start_host_pipeline()


def stop_accent_ai_host_pipeline() -> dict:
    return _manager._stop_host_pipeline()


def set_accent_ai_audio_defaults(*, input_label: str, output_label: str) -> dict:
    return set_linux_audio_defaults(input_label=input_label, output_label=output_label)
