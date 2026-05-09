"""Fix server.js: /v1/chat/completions -> /chat/completions"""
with open(r'E:\openclaw\murasame\src\server.js', 'rb') as f:
    data = f.read()

old = b'/v1/chat/completions'
new = b'/chat/completions'
count = data.count(old)
print(f'Found {count} occurrences of /v1/chat/completions')

if count > 0:
    newdata = data.replace(old, new)
    with open(r'E:\openclaw\murasame\src\server.js', 'wb') as f:
        f.write(newdata)
    print('Replaced successfully')

# Also fix in app_extract
with open(r'E:\openclaw\murasame\launcher\resources\app_extract\server.js', 'rb') as f:
    data2 = f.read()

count2 = data2.count(old)
print(f'Found {count2} occurrences in app_extract')
if count2 > 0:
    newdata2 = data2.replace(old, new)
    with open(r'E:\openclaw\murasame\launcher\resources\app_extract\server.js', 'wb') as f:
        f.write(newdata2)
    print('Replaced in app_extract')

# Also update config.json in app_extract
import json
with open(r'E:\openclaw\murasame\launcher\resources\app_extract\config.json', 'r', encoding='utf-8-sig') as f:
    d = json.load(f)
d['gateway']['url'] = 'http://127.0.0.1:19000/proxy/llm'
d['gateway']['model'] = 'modelroute'
with open(r'E:\openclaw\murasame\launcher\resources\app_extract\config.json', 'w', encoding='utf-8') as f:
    json.dump(d, f, ensure_ascii=False, indent=2)
print('Updated app_extract config.json')
