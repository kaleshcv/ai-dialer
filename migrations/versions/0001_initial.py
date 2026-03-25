"""initial integrated schema

Revision ID: 0001_initial
Revises: None
Create Date: 2026-03-24 00:00:00
"""
from alembic import op
import sqlalchemy as sa

revision = '0001_initial'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'tenants',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('timezone', sa.String(length=64), nullable=False, server_default='Asia/Kolkata'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('name'),
    )

    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('tenant_id', sa.Integer(), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('full_name', sa.String(length=255), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('role', sa.String(length=64), nullable=False, server_default='admin'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('email'),
    )
    op.create_index('ix_users_tenant_id', 'users', ['tenant_id'])
    op.create_index('ix_users_email', 'users', ['email'])

    op.create_table(
        'campaigns',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('tenant_id', sa.Integer(), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('dialing_mode', sa.String(length=32), nullable=False),
        sa.Column('status', sa.String(length=32), nullable=False, server_default='draft'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('max_concurrent_lines', sa.Integer(), nullable=False, server_default='10'),
        sa.Column('retry_attempts', sa.Integer(), nullable=False, server_default='3'),
        sa.Column('caller_id', sa.String(length=64), nullable=False, server_default='1000'),
        sa.Column('paused_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_campaigns_tenant_id', 'campaigns', ['tenant_id'])

    op.create_table(
        'agents',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('tenant_id', sa.Integer(), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('extension', sa.String(length=32), nullable=False),
        sa.Column('display_name', sa.String(length=255), nullable=True),
        sa.Column('status', sa.String(length=32), nullable=False, server_default='offline'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.UniqueConstraint('extension'),
    )
    op.create_index('ix_agents_tenant_id', 'agents', ['tenant_id'])
    op.create_index('ix_agents_user_id', 'agents', ['user_id'])

    op.create_table(
        'leads',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('tenant_id', sa.Integer(), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('campaign_id', sa.Integer(), sa.ForeignKey('campaigns.id', ondelete='CASCADE'), nullable=False),
        sa.Column('full_name', sa.String(length=255), nullable=False),
        sa.Column('phone_number', sa.String(length=32), nullable=False),
        sa.Column('timezone', sa.String(length=64), nullable=False, server_default='Asia/Kolkata'),
        sa.Column('status', sa.String(length=32), nullable=False, server_default='new'),
        sa.Column('attempt_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('last_attempt_at', sa.DateTime(), nullable=True),
        sa.Column('next_retry_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_leads_tenant_id', 'leads', ['tenant_id'])
    op.create_index('ix_leads_campaign_id', 'leads', ['campaign_id'])
    op.create_index('ix_leads_phone_number', 'leads', ['phone_number'])

    op.create_table(
        'call_attempts',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('tenant_id', sa.Integer(), sa.ForeignKey('tenants.id', ondelete='CASCADE'), nullable=False),
        sa.Column('campaign_id', sa.Integer(), sa.ForeignKey('campaigns.id', ondelete='CASCADE'), nullable=False),
        sa.Column('lead_id', sa.Integer(), sa.ForeignKey('leads.id', ondelete='CASCADE'), nullable=False),
        sa.Column('agent_id', sa.Integer(), sa.ForeignKey('agents.id', ondelete='SET NULL'), nullable=True),
        sa.Column('external_call_id', sa.String(length=128), nullable=True),
        sa.Column('status', sa.String(length=32), nullable=False, server_default='queued'),
        sa.Column('hangup_cause', sa.String(length=128), nullable=True),
        sa.Column('started_at', sa.DateTime(), nullable=True),
        sa.Column('answered_at', sa.DateTime(), nullable=True),
        sa.Column('ended_at', sa.DateTime(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_call_attempts_tenant_id', 'call_attempts', ['tenant_id'])
    op.create_index('ix_call_attempts_campaign_id', 'call_attempts', ['campaign_id'])
    op.create_index('ix_call_attempts_lead_id', 'call_attempts', ['lead_id'])
    op.create_index('ix_call_attempts_agent_id', 'call_attempts', ['agent_id'])
    op.create_index('ix_call_attempts_external_call_id', 'call_attempts', ['external_call_id'])

    op.create_table(
        'recordings',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('attempt_id', sa.Integer(), sa.ForeignKey('call_attempts.id', ondelete='CASCADE'), nullable=False),
        sa.Column('file_path', sa.String(length=512), nullable=False),
        sa.Column('duration_seconds', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_recordings_attempt_id', 'recordings', ['attempt_id'])


def downgrade() -> None:
    op.drop_index('ix_recordings_attempt_id', table_name='recordings')
    op.drop_table('recordings')
    op.drop_index('ix_call_attempts_external_call_id', table_name='call_attempts')
    op.drop_index('ix_call_attempts_agent_id', table_name='call_attempts')
    op.drop_index('ix_call_attempts_lead_id', table_name='call_attempts')
    op.drop_index('ix_call_attempts_campaign_id', table_name='call_attempts')
    op.drop_index('ix_call_attempts_tenant_id', table_name='call_attempts')
    op.drop_table('call_attempts')
    op.drop_index('ix_leads_phone_number', table_name='leads')
    op.drop_index('ix_leads_campaign_id', table_name='leads')
    op.drop_index('ix_leads_tenant_id', table_name='leads')
    op.drop_table('leads')
    op.drop_index('ix_agents_user_id', table_name='agents')
    op.drop_index('ix_agents_tenant_id', table_name='agents')
    op.drop_table('agents')
    op.drop_index('ix_campaigns_tenant_id', table_name='campaigns')
    op.drop_table('campaigns')
    op.drop_index('ix_users_email', table_name='users')
    op.drop_index('ix_users_tenant_id', table_name='users')
    op.drop_table('users')
    op.drop_table('tenants')
