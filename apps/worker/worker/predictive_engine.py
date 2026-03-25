import math


class PredictiveEngine:
    def __init__(self, target_occupancy: float, min_answer_rate: float, max_abandon_rate: float):
        self.target_occupancy = target_occupancy
        self.min_answer_rate = min_answer_rate
        self.max_abandon_rate = max_abandon_rate

    def compute(
        self,
        ready_agents: int,
        inflight: int,
        answer_rate: float,
        abandon_rate: float,
        line_limit: int,
    ) -> int:
        if ready_agents <= 0 or line_limit <= inflight:
            return 0

        normalized_answer_rate = max(answer_rate, self.min_answer_rate)
        desired_live_conversations = max(math.ceil(ready_agents * self.target_occupancy), 1)
        raw_dials_needed = math.ceil(desired_live_conversations / normalized_answer_rate)
        launches_needed = max(raw_dials_needed - inflight, 0)

        if abandon_rate > self.max_abandon_rate:
            launches_needed = math.floor(launches_needed * 0.5)

        available_lines = max(line_limit - inflight, 0)
        return min(launches_needed, available_lines)
