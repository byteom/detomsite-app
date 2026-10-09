from __future__ import annotations

import sqlite3

from app.core.local_db.connection import _column_exists, _connect, _db_path


def init_local_demo_db() -> None:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    with _connect() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS shops (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                rating REAL NOT NULL,
                opening_time TEXT NOT NULL,
                closing_time TEXT NOT NULL,
                present INTEGER NOT NULL,
                status TEXT NOT NULL,
                approval_status TEXT NOT NULL,
                shopkeeper_email TEXT DEFAULT '',
                shopkeeper_name TEXT NOT NULL,
                phone TEXT NOT NULL,
                upi_id TEXT DEFAULT '',
                upi_enabled INTEGER NOT NULL DEFAULT 1,
                cod_enabled INTEGER NOT NULL DEFAULT 1,
                orders_today INTEGER NOT NULL,
                revenue_today INTEGER NOT NULL,
                current_token INTEGER NOT NULL,
                is_removed INTEGER NOT NULL DEFAULT 0,
                admin_dues_balance INTEGER NOT NULL DEFAULT 0,
                admin_dues_last_paid_at TEXT
            );

            CREATE TABLE IF NOT EXISTS products (
                id TEXT PRIMARY KEY,
                shop_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL,
                price INTEGER NOT NULL,
                pending_price INTEGER,
                category TEXT NOT NULL,
                inventory INTEGER NOT NULL,
                prep_time INTEGER NOT NULL,
                available INTEGER NOT NULL,
                is_combo INTEGER NOT NULL DEFAULT 0,
                combo_items TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (shop_id) REFERENCES shops(id)
            );

            CREATE TABLE IF NOT EXISTS orders (
                id TEXT PRIMARY KEY,
                token INTEGER NOT NULL,
                student_name TEXT NOT NULL,
                student_phone TEXT NOT NULL,
                shop_id TEXT NOT NULL,
                shop_name TEXT NOT NULL,
                items TEXT NOT NULL,
                subtotal INTEGER NOT NULL DEFAULT 0,
                service_fee INTEGER NOT NULL DEFAULT 0,
                tax INTEGER NOT NULL DEFAULT 0,
                delivery_fee INTEGER NOT NULL DEFAULT 0,
                total INTEGER NOT NULL,
                delivery_location TEXT NOT NULL,
                delivery_slot TEXT NOT NULL,
                status TEXT NOT NULL,
                payment_method TEXT NOT NULL DEFAULT 'UPI',
                client_ref TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (shop_id) REFERENCES shops(id)
            );

            CREATE TABLE IF NOT EXISTS payments (
                id TEXT PRIMARY KEY,
                order_id TEXT NOT NULL,
                amount INTEGER NOT NULL,
                method TEXT NOT NULL,
                status TEXT NOT NULL,
                utr_number TEXT,
                screenshot_name TEXT,
                proof_status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
                payment_screenshot_url TEXT NOT NULL DEFAULT '',
                payment_screenshot_public_id TEXT NOT NULL DEFAULT '',
                payment_submitted_at TEXT,
                payment_verified_at TEXT,
                payment_verified_by TEXT NOT NULL DEFAULT '',
                payment_rejection_reason TEXT NOT NULL DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (order_id) REFERENCES orders(id)
            );

            CREATE TABLE IF NOT EXISTS tickets (
                id TEXT PRIMARY KEY,
                ticket_number TEXT NOT NULL,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                phone_number TEXT NOT NULL,
                category TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                order_id TEXT,
                status TEXT,
                target_role TEXT DEFAULT '',
                is_read INTEGER NOT NULL DEFAULT 0,
                action TEXT NOT NULL DEFAULT '',
                action_state TEXT NOT NULL DEFAULT 'none',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                name TEXT NOT NULL,
                email TEXT DEFAULT '',
                phone TEXT DEFAULT '',
                role TEXT NOT NULL CHECK(role IN ('student','shopkeeper','admin')),
                status TEXT NOT NULL DEFAULT 'active',
                avatar_url TEXT DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_registrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                name TEXT NOT NULL,
                email TEXT DEFAULT '',
                phone TEXT DEFAULT '',
                role TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS share_payments (
                id TEXT PRIMARY KEY,
                shop_id TEXT NOT NULL,
                shop_name TEXT NOT NULL DEFAULT '',
                amount INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'Pending',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                paid_at TEXT
            );

            CREATE TABLE IF NOT EXISTS push_subscriptions (
                endpoint TEXT PRIMARY KEY,
                shop_id TEXT NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_push_subscriptions_shop_id ON push_subscriptions (shop_id);

            CREATE TABLE IF NOT EXISTS password_resets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                otp TEXT NOT NULL,
                step INTEGER NOT NULL DEFAULT 1,
                expires_at TEXT NOT NULL,
                used INTEGER NOT NULL DEFAULT 0,
                attempts INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- ─── Site feedback / bug reports: students test the site and
            -- contribute bugs + improvement ideas; the admin reviews them on
            -- the Feedback page (who sent it, what was said, status). ───
            CREATE TABLE IF NOT EXISTS site_feedback (
                id TEXT PRIMARY KEY,
                user_id INTEGER,
                username TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL DEFAULT '',
                email TEXT NOT NULL DEFAULT '',
                category TEXT NOT NULL DEFAULT 'Bug',
                subject TEXT NOT NULL DEFAULT '',
                message TEXT NOT NULL DEFAULT '',
                page TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'Open',
                -- Where the contribution came from: 'User' = submitted by a
                -- real student through the portal; 'ATS' = generated by the
                -- automated test suite. The admin Feedback page filters on this.
                source TEXT NOT NULL DEFAULT 'User',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_site_feedback_status ON site_feedback (status);
            CREATE INDEX IF NOT EXISTS idx_site_feedback_user ON site_feedback (user_id);

            -- ─── Indexes: every hot query below ships through an index instead
            -- of a full table scan (big speed win as order/product volume grows). ───
            CREATE INDEX IF NOT EXISTS idx_orders_shop_id ON orders (shop_id);
            CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at);
            CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
            CREATE INDEX IF NOT EXISTS idx_products_shop_id ON products (shop_id);
            CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments (order_id);
            CREATE INDEX IF NOT EXISTS idx_notifications_target_role ON notifications (target_role, id);
            CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
            CREATE INDEX IF NOT EXISTS idx_share_payments_shop_id ON share_payments (shop_id);
            CREATE INDEX IF NOT EXISTS idx_password_resets_username ON password_resets (username, used);

            -- ─── Shop reviews: students rate shops after ordering. ───
            CREATE TABLE IF NOT EXISTS reviews (
                id TEXT PRIMARY KEY,
                user_id INTEGER,
                username TEXT NOT NULL DEFAULT '',
                student_name TEXT NOT NULL DEFAULT '',
                shop_id TEXT NOT NULL DEFAULT '',
                shop_name TEXT NOT NULL DEFAULT '',
                rating INTEGER NOT NULL DEFAULT 5,
                comment TEXT NOT NULL DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_reviews_shop_id ON reviews (shop_id);

            -- ─── Multi-shop order system ───
            CREATE TABLE IF NOT EXISTS parent_orders (
                id TEXT PRIMARY KEY,
                token INTEGER NOT NULL,
                student_name TEXT NOT NULL,
                student_phone TEXT NOT NULL,
                student_email TEXT NOT NULL DEFAULT '',
                student_id TEXT NOT NULL DEFAULT '',
                total INTEGER NOT NULL DEFAULT 0,
                payment_method TEXT NOT NULL DEFAULT 'UTR',
                payment_status TEXT NOT NULL DEFAULT 'Pending',
                delivery_location TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'Pending',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_parent_orders_token ON parent_orders (token);
            CREATE INDEX IF NOT EXISTS idx_parent_orders_student ON parent_orders (student_name);

            CREATE TABLE IF NOT EXISTS shop_sub_orders (
                id TEXT PRIMARY KEY,
                parent_order_id TEXT NOT NULL,
                shop_id TEXT NOT NULL,
                shop_name TEXT NOT NULL,
                shop_phone TEXT NOT NULL DEFAULT '',
                shop_whatsapp TEXT NOT NULL DEFAULT '',
                token INTEGER NOT NULL,
                items_summary TEXT NOT NULL DEFAULT '',
                subtotal INTEGER NOT NULL DEFAULT 0,
                commission_5pct INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'Pending',
                accepted_at TEXT,
                prepared_at TEXT,
                ready_at TEXT,
                completed_at TEXT,
                delivered_at TEXT,
                rejection_reason TEXT NOT NULL DEFAULT '',
                cancellation_reason TEXT NOT NULL DEFAULT '',
                batch_type TEXT NOT NULL DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (parent_order_id) REFERENCES parent_orders(id),
                FOREIGN KEY (shop_id) REFERENCES shops(id)
            );
            CREATE INDEX IF NOT EXISTS idx_sub_orders_parent ON shop_sub_orders (parent_order_id);
            CREATE INDEX IF NOT EXISTS idx_sub_orders_shop ON shop_sub_orders (shop_id);
            CREATE INDEX IF NOT EXISTS idx_sub_orders_status ON shop_sub_orders (status);

            CREATE TABLE IF NOT EXISTS order_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sub_order_id TEXT NOT NULL,
                product_id TEXT NOT NULL,
                product_name TEXT NOT NULL,
                price INTEGER NOT NULL,
                quantity INTEGER NOT NULL DEFAULT 1,
                total INTEGER NOT NULL,
                FOREIGN KEY (sub_order_id) REFERENCES shop_sub_orders(id)
            );
            CREATE INDEX IF NOT EXISTS idx_order_items_sub ON order_items (sub_order_id);

            -- ─── Delivery batches ───
            CREATE TABLE IF NOT EXISTS delivery_batches (
                id TEXT PRIMARY KEY,
                batch_type TEXT NOT NULL,
                order_start TEXT NOT NULL,
                order_end TEXT NOT NULL,
                delivery_start TEXT NOT NULL,
                delivery_end TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- ─── Per-batch product stock ───
            CREATE TABLE IF NOT EXISTS product_stock (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_id TEXT NOT NULL,
                batch_type TEXT NOT NULL,
                default_stock INTEGER NOT NULL DEFAULT 0,
                current_stock INTEGER NOT NULL DEFAULT 0,
                date_key TEXT NOT NULL,
                FOREIGN KEY (product_id) REFERENCES products(id)
            );
            CREATE INDEX IF NOT EXISTS idx_product_stock_product ON product_stock (product_id, batch_type, date_key);

            -- ─── Complaints ───
            CREATE TABLE IF NOT EXISTS complaints (
                id TEXT PRIMARY KEY,
                parent_order_id TEXT NOT NULL,
                sub_order_id TEXT NOT NULL DEFAULT '',
                student_name TEXT NOT NULL DEFAULT '',
                student_phone TEXT NOT NULL DEFAULT '',
                shop_id TEXT NOT NULL DEFAULT '',
                shop_name TEXT NOT NULL DEFAULT '',
                subject TEXT NOT NULL DEFAULT '',
                message TEXT NOT NULL DEFAULT '',
                proof_url TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'New',
                admin_notes TEXT NOT NULL DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (parent_order_id) REFERENCES parent_orders(id)
            );
            CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints (status);

            -- ─── Refunds ───
            CREATE TABLE IF NOT EXISTS refunds (
                id TEXT PRIMARY KEY,
                parent_order_id TEXT NOT NULL,
                sub_order_id TEXT NOT NULL DEFAULT '',
                student_name TEXT NOT NULL DEFAULT '',
                shop_name TEXT NOT NULL DEFAULT '',
                original_amount INTEGER NOT NULL DEFAULT 0,
                refund_amount INTEGER NOT NULL DEFAULT 0,
                refund_type TEXT NOT NULL DEFAULT 'Full',
                refund_utr TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'Pending',
                admin_notes TEXT NOT NULL DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                completed_at TEXT,
                FOREIGN KEY (parent_order_id) REFERENCES parent_orders(id)
            );
            CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds (status);

            -- ─── Daily settlements ───
            CREATE TABLE IF NOT EXISTS settlements (
                id TEXT PRIMARY KEY,
                shop_id TEXT NOT NULL,
                shop_name TEXT NOT NULL DEFAULT '',
                date_key TEXT NOT NULL,
                gross_sales INTEGER NOT NULL DEFAULT 0,
                commission_5pct INTEGER NOT NULL DEFAULT 0,
                refunds_adjusted INTEGER NOT NULL DEFAULT 0,
                net_payable INTEGER NOT NULL DEFAULT 0,
                cod_collected INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'Pending',
                settlement_utr TEXT NOT NULL DEFAULT '',
                admin_notes TEXT NOT NULL DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                completed_at TEXT,
                FOREIGN KEY (shop_id) REFERENCES shops(id)
            );
            CREATE INDEX IF NOT EXISTS idx_settlements_shop ON settlements (shop_id, date_key);

            -- ─── Menu change requests (approval workflow) ───
            CREATE TABLE IF NOT EXISTS menu_change_requests (
                id TEXT PRIMARY KEY,
                shop_id TEXT NOT NULL,
                product_id TEXT NOT NULL DEFAULT '',
                change_type TEXT NOT NULL,
                field_name TEXT NOT NULL DEFAULT '',
                old_value TEXT NOT NULL DEFAULT '',
                new_value TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'Pending',
                admin_notes TEXT NOT NULL DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                reviewed_at TEXT,
                FOREIGN KEY (shop_id) REFERENCES shops(id)
            );
            CREATE INDEX IF NOT EXISTS idx_menu_changes_shop ON menu_change_requests (shop_id, status);

            -- ─── Shop notification bar (shop can post announcements to students) ───
            CREATE TABLE IF NOT EXISTS shop_announcements (
                id TEXT PRIMARY KEY,
                shop_id TEXT NOT NULL,
                message TEXT NOT NULL DEFAULT '',
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (shop_id) REFERENCES shops(id)
            );
            CREATE INDEX IF NOT EXISTS idx_shop_announcements_shop ON shop_announcements (shop_id, is_active);

            -- ─── Student favorites ───
            CREATE TABLE IF NOT EXISTS favorites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                student_name TEXT NOT NULL DEFAULT '',
                target_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_favorites_student ON favorites (student_name, target_type);

            -- ─── WhatsApp message logs ───
            CREATE TABLE IF NOT EXISTS whatsapp_logs (
                id TEXT PRIMARY KEY,
                sub_order_id TEXT NOT NULL DEFAULT '',
                phone TEXT NOT NULL DEFAULT '',
                message TEXT NOT NULL DEFAULT '',
                url TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'Sent',
                claimed_at TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- ─── SMS logs (order confirm/reject via phone text) ───
            CREATE TABLE IF NOT EXISTS sms_logs (
                id TEXT PRIMARY KEY,
                sub_order_id TEXT NOT NULL DEFAULT '',
                phone TEXT NOT NULL DEFAULT '',
                message TEXT NOT NULL DEFAULT '',
                direction TEXT NOT NULL DEFAULT 'out',
                status TEXT NOT NULL DEFAULT 'Sent',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- ─── Shop ordering position (admin-controlled) ───
            -- Added to shops table via ALTER below.

            -- ─── Audit logs ───
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_user TEXT NOT NULL DEFAULT '',
                action TEXT NOT NULL DEFAULT '',
                entity_type TEXT NOT NULL DEFAULT '',
                entity_id TEXT NOT NULL DEFAULT '',
                old_value TEXT NOT NULL DEFAULT '',
                new_value TEXT NOT NULL DEFAULT '',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs (entity_type, entity_id);

            -- ─── Shop order lock time (auto-delivery after 30 min) ───
            -- added to shop_sub_orders via delivered_at/completed_at timestamps.

            -- ─── Duplicate UTR protection ───
            CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_utr_unique ON payments (utr_number) WHERE utr_number IS NOT NULL AND utr_number != '';
            """
        )

        if not _column_exists(connection, "payments", "screenshot_name"):
            connection.execute("ALTER TABLE payments ADD COLUMN screenshot_name TEXT")
        if not _column_exists(connection, "shops", "shopkeeper_email"):
            connection.execute("ALTER TABLE shops ADD COLUMN shopkeeper_email TEXT DEFAULT ''")
        if not _column_exists(connection, "users", "email"):
            connection.execute("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''")
        if not _column_exists(connection, "users", "phone"):
            connection.execute("ALTER TABLE users ADD COLUMN phone TEXT DEFAULT ''")
        if not _column_exists(connection, "users", "status"):
            connection.execute("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
        if not _column_exists(connection, "users", "avatar_url"):
            connection.execute("ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''")
        if not _column_exists(connection, "shops", "upi_id"):
            connection.execute("ALTER TABLE shops ADD COLUMN upi_id TEXT DEFAULT ''")
        if not _column_exists(connection, "shops", "upi_enabled"):
            connection.execute("ALTER TABLE shops ADD COLUMN upi_enabled INTEGER NOT NULL DEFAULT 1")
        if not _column_exists(connection, "shops", "cod_enabled"):
            connection.execute("ALTER TABLE shops ADD COLUMN cod_enabled INTEGER NOT NULL DEFAULT 1")
        if not _column_exists(connection, "shops", "is_removed"):
            connection.execute("ALTER TABLE shops ADD COLUMN is_removed INTEGER NOT NULL DEFAULT 0")
        if not _column_exists(connection, "shops", "admin_dues_balance"):
            connection.execute("ALTER TABLE shops ADD COLUMN admin_dues_balance INTEGER NOT NULL DEFAULT 0")
        if not _column_exists(connection, "shops", "admin_dues_last_paid_at"):
            connection.execute("ALTER TABLE shops ADD COLUMN admin_dues_last_paid_at TEXT")
        if not _column_exists(connection, "parent_orders", "utr_number"):
            connection.execute("ALTER TABLE parent_orders ADD COLUMN utr_number TEXT")
        if not _column_exists(connection, "parent_orders", "screenshot_name"):
            connection.execute("ALTER TABLE parent_orders ADD COLUMN screenshot_name TEXT")
        # Manual UPI payment-proof workflow (UTR + Cloudinary screenshot + admin
        # verification). Mirrors the Supabase migrations in supabase_db.py.
        for _col, _ddl in (
            ("proof_status", "TEXT NOT NULL DEFAULT 'PENDING_PAYMENT'"),
            ("payment_screenshot_url", "TEXT NOT NULL DEFAULT ''"),
            ("payment_screenshot_public_id", "TEXT NOT NULL DEFAULT ''"),
            ("payment_submitted_at", "TEXT"),
            ("payment_verified_at", "TEXT"),
            ("payment_verified_by", "TEXT NOT NULL DEFAULT ''"),
            ("payment_rejection_reason", "TEXT NOT NULL DEFAULT ''"),
        ):
            if not _column_exists(connection, "payments", _col):
                connection.execute(f"ALTER TABLE payments ADD COLUMN {_col} {_ddl}")
        for _col, _ddl in (
            ("payment_proof_status", "TEXT NOT NULL DEFAULT 'PENDING_PAYMENT'"),
            ("payment_screenshot_url", "TEXT NOT NULL DEFAULT ''"),
            ("payment_screenshot_public_id", "TEXT NOT NULL DEFAULT ''"),
            ("payment_submitted_at", "TEXT"),
            ("payment_verified_at", "TEXT"),
            ("payment_verified_by", "TEXT NOT NULL DEFAULT ''"),
            ("payment_rejection_reason", "TEXT NOT NULL DEFAULT ''"),
        ):
            if not _column_exists(connection, "parent_orders", _col):
                connection.execute(f"ALTER TABLE parent_orders ADD COLUMN {_col} {_ddl}")
        if not _column_exists(connection, "shops", "ordering_position"):
            connection.execute("ALTER TABLE shops ADD COLUMN ordering_position INTEGER NOT NULL DEFAULT 0")
        if not _column_exists(connection, "shops", "whatsapp_number"):
            connection.execute("ALTER TABLE shops ADD COLUMN whatsapp_number TEXT DEFAULT ''")
        if not _column_exists(connection, "shops", "is_featured"):
            connection.execute("ALTER TABLE shops ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0")
        if not _column_exists(connection, "shops", "shop_image"):
            connection.execute("ALTER TABLE shops ADD COLUMN shop_image TEXT DEFAULT ''")
        # Combo products: ONE price for MANY items (e.g. Biryani + Coke + Fries
        # = ₹199). is_combo marks it; combo_items stores the item list as text.
        if not _column_exists(connection, "products", "is_combo"):
            connection.execute("ALTER TABLE products ADD COLUMN is_combo INTEGER NOT NULL DEFAULT 0")
        if not _column_exists(connection, "products", "combo_items"):
            connection.execute("ALTER TABLE products ADD COLUMN combo_items TEXT NOT NULL DEFAULT ''")
        for table in ("orders", "parent_orders"):
            if not _column_exists(connection, table, "owner_user_id"):
                connection.execute(f"ALTER TABLE {table} ADD COLUMN owner_user_id TEXT NOT NULL DEFAULT ''")
        if not _column_exists(connection, "orders", "parent_order_id"):
            connection.execute("ALTER TABLE orders ADD COLUMN parent_order_id TEXT DEFAULT ''")
        if not _column_exists(connection, "orders", "batch_type"):
            connection.execute("ALTER TABLE orders ADD COLUMN batch_type TEXT DEFAULT ''")
        if not _column_exists(connection, "orders", "is_combo"):
            connection.execute("ALTER TABLE orders ADD COLUMN is_combo INTEGER NOT NULL DEFAULT 0")
        if not _column_exists(connection, "orders", "subtotal"):
            connection.execute("ALTER TABLE orders ADD COLUMN subtotal INTEGER NOT NULL DEFAULT 0")
        if not _column_exists(connection, "orders", "service_fee"):
            connection.execute("ALTER TABLE orders ADD COLUMN service_fee INTEGER NOT NULL DEFAULT 0")
        if not _column_exists(connection, "orders", "tax"):
            connection.execute("ALTER TABLE orders ADD COLUMN tax INTEGER NOT NULL DEFAULT 0")
        if not _column_exists(connection, "orders", "delivery_fee"):
            connection.execute("ALTER TABLE orders ADD COLUMN delivery_fee INTEGER NOT NULL DEFAULT 0")
        if not _column_exists(connection, "notifications", "target_role"):
            connection.execute("ALTER TABLE notifications ADD COLUMN target_role TEXT DEFAULT ''")
        # Inline admin action on a notification (the bell's Confirm button).
        if not _column_exists(connection, "notifications", "action"):
            connection.execute("ALTER TABLE notifications ADD COLUMN action TEXT NOT NULL DEFAULT ''")
        if not _column_exists(connection, "notifications", "action_state"):
            connection.execute("ALTER TABLE notifications ADD COLUMN action_state TEXT NOT NULL DEFAULT 'none'")
        if not _column_exists(connection, "orders", "payment_method"):
            connection.execute("ALTER TABLE orders ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'UPI'")
        # Idempotency key for checkout. The payment page may have to retry the
        # order POST (cold starts on the serverless host are slow enough to time
        # out), and a naive retry created a SECOND order for the same basket.
        # Two same-amount unpaid orders at one shop is exactly the ambiguity
        # tier-2 bank matching refuses to guess at, so a retry used to deadlock
        # the student who had already paid. A stable client-supplied ref makes
        # every retry return the FIRST order instead of forking a new one.
        if not _column_exists(connection, "orders", "client_ref"):
            connection.execute("ALTER TABLE orders ADD COLUMN client_ref TEXT")
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_orders_client_ref ON orders (client_ref)"
        )
        if not _column_exists(connection, "password_resets", "attempts"):
            connection.execute("ALTER TABLE password_resets ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0")
        # Durable "already handed to the WhatsApp bot" stamp — see the Supabase
        # migration note. Without it a delivered message whose mark-sent was lost
        # is offered again on every poll and the shop is messaged repeatedly.
        if not _column_exists(connection, "whatsapp_logs", "claimed_at"):
            connection.execute("ALTER TABLE whatsapp_logs ADD COLUMN claimed_at TEXT")
        if not _column_exists(connection, "site_feedback", "subject"):
            connection.execute("ALTER TABLE site_feedback ADD COLUMN subject TEXT NOT NULL DEFAULT ''")
        if not _column_exists(connection, "site_feedback", "page"):
            connection.execute("ALTER TABLE site_feedback ADD COLUMN page TEXT NOT NULL DEFAULT ''")
        if not _column_exists(connection, "site_feedback", "source"):
            connection.execute("ALTER TABLE site_feedback ADD COLUMN source TEXT NOT NULL DEFAULT 'User'")
            # One-time backfill: every row that existed BEFORE this column was
            # added was generated by the automated test suite (the feature
            # didn't exist for real users yet) → tag them all as ATS.
            connection.execute("UPDATE site_feedback SET source = 'ATS'")
        # The index lives OUTSIDE the big executescript so it can only be
        # created after the ALTER fallback above guarantees the column exists
        # (legacy databases fail otherwise).
        connection.execute("CREATE INDEX IF NOT EXISTS idx_site_feedback_source ON site_feedback (source)")

        # One account per email (case-insensitive, non-empty only so legacy
        # rows with a blank email aren't blocked). Created OUTSIDE the big
        # executescript so a legacy database that already contains duplicate
        # emails logs the failure instead of breaking app startup.
        try:
            connection.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique ON users (LOWER(email)) WHERE email != ''"
            )
        except sqlite3.Error:
            pass  # legacy duplicate emails — the app-level check still blocks new ones

        # No seed data. All shops, products, and orders are created by real users.

        # ─── Schema migration: URL for WhatsApp notifications (for demo DBs
        # created before the column existed). ───
        try:
            cols = [r[1] for r in connection.execute("PRAGMA table_info(whatsapp_logs)")]
            if "url" not in cols:
                connection.execute("ALTER TABLE whatsapp_logs ADD COLUMN url TEXT NOT NULL DEFAULT ''")
        except sqlite3.Error:
            pass

        # ─── Seed default delivery batches (Afternoon / Night). ───
        connection.execute(
            """
            INSERT OR IGNORE INTO delivery_batches
            (id, batch_type, order_start, order_end, delivery_start, delivery_end, is_active)
            VALUES
            ('batch-afternoon', 'Afternoon', '09:00', '12:30', '13:00', '13:30', 1),
            ('batch-night', 'Night', '13:00', '18:00', '19:30', '19:45', 1)
            """
        )
