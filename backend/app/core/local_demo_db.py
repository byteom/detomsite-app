from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.core.local_db.analytics import (
    get_admin_dashboard_stats,
    get_daily_stats,
    get_orders_by_date,
    get_orders_grouped_by_date,
    get_payments_by_date,
    get_summary,
    get_vendor_daily_logs,
    get_vendor_orders,
)
from app.core.local_db.connection import (
    _NamedRow,
    _NamedRowConnection,
    _NamedRowCursor,
    _column_exists,
    _day_key,
    _insert_with_suffixed_id,
    _next_suffixed_id,
    _rows_to_dicts,
    _shop_is_orderable,
    consume_batch_stock,
    consume_token,
    get_current_batch,
    get_default_stock,
    get_next_token,
    get_product_stock,
    get_product_stocks,
    init_batch_stock,
    release_batch_stock,
)
from app.core.local_db.notifications import (
    NOTIFICATION_LIST_LIMIT,
    create_notification,
    list_actionable_notifications,
    list_notifications,
    list_push_subscriptions,
    list_student_notifications,
    remove_push_subscription,
    save_push_subscription,
    set_notification_action_state,
)
from app.core.local_db.orders import (
    create_order,
    find_order_by_client_ref,
    find_order_by_token,
    get_daily_token_count,
    get_order,
    list_orders,
    list_orders_by_shop,
    list_orders_by_user_id,
    list_recent_orders_by_shop,
    update_order_status,
)
from app.core.local_db.parent_orders import (
    auto_complete_expired_deliveries,
    cancel_parent_order,
    create_parent_order,
    get_parent_order,
    get_shop_sub_orders,
    get_sub_order,
    list_all_sub_orders,
    list_parent_orders,
    update_parent_order_status,
    update_sub_order_status,
)
from app.core.local_db.payments import (
    _parent_payment_shape,
    bank_sms_seen,
    create_payment,
    get_parent_payment,
    get_payment_by_id,
    get_payment_by_order_id,
    get_payment_by_utr,
    get_payments_map_by_order_ids,
    get_payment_settings,
    get_student_notice,
    list_parent_payments,
    list_payments,
    list_payments_by_utr,
    record_parent_payment,
    save_parent_payment_proof,
    save_single_payment_proof,
    set_payment_utr,
    settle_payment_if_open,
    update_payment_settings,
    update_payment_status,
    update_student_notice,
    verify_parent_payment,
    verify_parent_payment_proof,
    verify_single_payment_proof,
)
from app.core.local_db.schema import (
    init_local_demo_db,
)
from app.core.local_db.shops import (
    create_product,
    create_shop,
    delete_product,
    get_product,
    get_shop,
    get_shop_by_phone,
    get_shop_by_shopkeeper_email,
    list_products,
    list_share_payments,
    list_share_payments_by_shop,
    list_shops,
    menu_summary,
    pay_admin_dues,
    record_share_payment,
    remove_shop,
    suspend_shop,
    update_product,
    update_share_payment_status,
    update_shop,
)
from app.core.local_db.support import (
    add_audit_log,
    claim_next_whatsapp_log,
    create_complaint,
    create_menu_change_request,
    create_refund,
    create_review,
    create_shop_announcement,
    create_site_feedback,
    create_ticket,
    delete_site_feedback,
    list_audit_logs,
    list_complaints,
    list_menu_change_requests,
    list_refunds,
    list_reviews,
    list_reviews_by_user,
    list_settlements,
    list_shop_announcements,
    list_site_feedback,
    list_site_feedback_by_user,
    list_sms_logs,
    list_tickets,
    list_tickets_for_user,
    list_whatsapp_logs,
    log_sms,
    log_whatsapp,
    mark_whatsapp_sent,
    run_daily_settlements,
    toggle_shop_announcement,
    update_complaint,
    update_menu_change_request,
    update_refund,
    update_site_feedback_status,
    update_whatsapp_message,
)
from app.core.local_db.users import (
    bump_password_reset_attempts,
    create_password_reset,
    delete_user,
    ensure_admin_user,
    get_password_reset,
    get_user_by_email,
    get_user_by_id,
    get_user_by_username,
    get_user_overview,
    invalidate_password_resets,
    list_registrations,
    list_users,
    list_users_by_role,
    record_registration,
    register_user,
    save_session,
    set_user_status,
    update_user_admin,
    update_user_password,
    update_user_profile,
)


def _db_path(base_file: Path | str | None = None) -> Path:
    path = Path(settings.LOCAL_DB_PATH)
    if not path.is_absolute():
        origin = Path(base_file) if base_file else Path(__file__)
        path = (origin.resolve().parents[2] / path).resolve()
    return path


def _connect(base_file: Path | str | None = None) -> Any:
    """Test-only SQLite connection (pytest). Production uses Supabase."""
    connection = sqlite3.connect(_db_path(base_file), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute("PRAGMA busy_timeout=8000")
    return connection
