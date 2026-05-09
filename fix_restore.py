"""Restore server.js: /chat/completions -> /v1/chat/completions, and fix config"""
import json

# Fix src/server.js
with open(r'E:\openclaw\murasame\src\server.js', 'rb') as f:
    data = f.read()
old = b'/chat/completions'
new = b'/v1/chat/completions'
count = data.count(old)
print(f'src/server.js: Found {count} occurrences of /chat/completions')
if count > 0:
    newdata = data.replace(old, new)
    with open(r'E:\openclaw\murasame\src\server.js', 'wb') as f:
        f.write(newdata)
    print('  Reverted to /v1/chat/completions')

# Fix app_extract/server.js
with open(r'E:\openclaw\murasame\launcher\resources\app_extract\server.js', 'rb') as f:
    data2 = f.read()
count2 = data2.count(old)
print(f'app_extract/server.js: Found {count2} occurrences')
if count2 > 0:
    newdata2 = data2.replace(old, new)
    with open(r'E:\openclaw\murasame\launcher\resources\app_extract\server.js', 'wb') as f:
        f.write(newdata2)
    print('  Reverted to /v1/chat/completions')

# Restore config.json gateway url
for cfg_path in [r'E:\openclaw\murasame\src\config.json', r'E:\openclaw\murasame\launcher\resources\app_extract\config.json']:
    with open(cfg_path, 'r', encoding='utf-8-sig') as f:
        d = json.load(f)
    d['gateway']['url'] = 'http://127.0.0.1:28789'
    with open(cfg_path, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print(f'  Restored gateway.url in {cfg_path}')
