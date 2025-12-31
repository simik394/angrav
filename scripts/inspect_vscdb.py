
import sqlite3
import sys
import os

db_path = "/home/sim/.config/Antigravity/User/workspaceStorage/c9c6bd59ed6332a7daa9206014c75294/state.vscdb"

print(f"Inspecting {db_path}...")

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # List tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = cursor.fetchall()
    print(f"Tables: {tables}")
    
    # Dump ItemTable (standard VS Code state table)
    if ('ItemTable',) in tables:
        print("\n--- Chat Keys ---")
        cursor.execute("SELECT key, value FROM ItemTable WHERE key LIKE 'chat.%'")
        rows = cursor.fetchall()
        for key, value in rows:
            print(f"Key: {key}")
            print(f"Size: {len(value)} bytes")
            # Try to decode if possible
            try:
                print(f"Value: {value.decode('utf-8')[:200]}...")
            except:
                print(f"Value: <binary>")
            print("-" * 20)
            
    conn.close()

except Exception as e:
    print(f"Error: {e}")
