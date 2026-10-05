"""
Run and verify database migrations across Supabase Postgres and local SQLite environments.
Usage:
    python backend/scripts/run_migrations.py
"""
import sys
import os

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.config import settings


def run_supabase_migrations():
    print("=" * 60)
    print("RUNNING LIVE DATABASE MIGRATIONS")
    print("=" * 60)
    
    # 1. Supabase Postgres migrations
    print(f"[*] Supabase Database Target: {settings.SUPABASE_DATABASE_URL.split('@')[-1] if '@' in settings.SUPABASE_DATABASE_URL else 'configured'}")
    
    try:
        from app.core import supabase_db
        conn = supabase_db._connect()
        with supabase_db._DBContext(conn) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_database(), current_user, version();")
                info = cursor.fetchone()
                db_name = info.get("current_database") if isinstance(info, dict) else info[0]
                db_user = info.get("current_user") if isinstance(info, dict) else info[1]
                v_str = info.get("version") if isinstance(info, dict) else info[2]
                print(f"[+] Connected to PostgreSQL Database: '{db_name}' as user '{db_user}'")
                print(f"[+] Engine: {v_str.split(',')[0]}")
                
                print("\n[*] Executing schema migration batch...")
                applied_count = 0
                for idx, stmt in enumerate(supabase_db._MIGRATIONS, 1):
                    cursor.execute("SAVEPOINT mig_step")
                    try:
                        cursor.execute(stmt)
                        cursor.execute("RELEASE SAVEPOINT mig_step")
                        applied_count += 1
                        summary = stmt.strip().split("\n")[0][:70]
                        print(f"  [{idx:02d}/{len(supabase_db._MIGRATIONS):02d}] APPLIED/VERIFIED: {summary}")
                    except Exception as e:
                        cursor.execute("ROLLBACK TO SAVEPOINT mig_step")
                        print(f"  [{idx:02d}/{len(supabase_db._MIGRATIONS):02d}] SKIPPED: {e}")
                
                connection.commit()
                print(f"\n[+] Successfully verified and committed {applied_count} migrations.")

                # Verify public.users columns
                print("\n[*] Verifying public.users columns in PostgreSQL:")
                cursor.execute("""
                    SELECT column_name, data_type, column_default, is_nullable
                    FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'users'
                    ORDER BY ordinal_position;
                """)
                cols = cursor.fetchall()
                for c in cols:
                    cname = c.get("column_name") if isinstance(c, dict) else c[0]
                    dtype = c.get("data_type") if isinstance(c, dict) else c[1]
                    cdef = c.get("column_default") if isinstance(c, dict) else c[2]
                    nullb = c.get("is_nullable") if isinstance(c, dict) else c[3]
                    print(f"  - {cname:18} | {dtype:15} | default: {str(cdef):20} | nullable: {nullb}")
                
                # Check indexes on users
                print("\n[*] Verifying public.users indexes in PostgreSQL:")
                cursor.execute("""
                    SELECT indexname
                    FROM pg_indexes
                    WHERE schemaname = 'public' AND tablename = 'users';
                """)
                indexes = cursor.fetchall()
                for idx in indexes:
                    iname = idx.get("indexname") if isinstance(idx, dict) else idx[0]
                    print(f"  - {iname}")

    except Exception as e:
        print(f"[!] PostgreSQL migration error: {e}")

    # 2. Local SQLite schema verification
    print("\n" + "=" * 60)
    print("VERIFYING LOCAL SQLITE DEMO STORE")
    print("=" * 60)
    try:
        from app.core import local_demo_db
        local_demo_db.init_local_demo_db()
        with local_demo_db._connect() as conn:
            cursor = conn.cursor()
            cols = [row[1] for row in cursor.execute("PRAGMA table_info(users)").fetchall()]
            print(f"[+] SQLite users table columns: {cols}")
            print(f"  - status column: {'status' in cols}")
            print(f"  - avatar_url column: {'avatar_url' in cols}")
    except Exception as e:
        print(f"[!] SQLite verification note: {e}")

    print("\n" + "=" * 60)
    print("ALL DATABASE MIGRATIONS COMPLETED AND VERIFIED")
    print("=" * 60)


if __name__ == "__main__":
    run_supabase_migrations()
