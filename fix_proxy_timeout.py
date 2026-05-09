"""Fix server.js: add 120s timeout to proxyRequest http.request call"""
with open(r'E:\openclaw\murasame\src\server.js', 'rb') as f:
    data = f.read()

# The proxyRequest function creates http.request without timeout
# We need to add timeout: 120000 (120 seconds) to the options
old = b"headers: { ...req.headers, ...headers }\r\n  }, pr"
new = b"headers: { ...req.headers, ...headers }, timeout: 120000\r\n  }, pr"

count = data.count(old)
print(f"Found {count} occurrences of proxy http.request pattern")

if count > 0:
    data = data.replace(old, new)
    with open(r'E:\openclaw\murasame\src\server.js', 'wb') as f:
        f.write(data)
    print("Added 120s timeout to proxyRequest")
else:
    # Try alternate pattern
    old2 = b"headers: { ...req.headers, ...headers }\n  }, pr"
    new2 = b"headers: { ...req.headers, ...headers }, timeout: 120000\n  }, pr"
    count2 = data.count(old2)
    print(f"Alternate pattern: {count2} occurrences")
    if count2 > 0:
        data = data.replace(old2, new2)
        with open(r'E:\openclaw\murasame\src\server.js', 'wb') as f:
            f.write(data)
        print("Added 120s timeout to proxyRequest (alt)")
    else:
        # Search for the actual pattern
        idx = data.find(b"headers: { ...req.headers, ...headers }")
        if idx >= 0:
            print(f"Found headers spread at byte {idx}")
            print(f"Context: {repr(data[idx:idx+80])}")

# Also do app_extract
with open(r'E:\openclaw\murasame\launcher\resources\app_extract\server.js', 'rb') as f:
    data2 = f.read()
count3 = data2.count(old)
count4 = data2.count(old2) if 'old2' in dir() else 0
print(f"app_extract: {count3} main, {count4} alt occurrences")
if count3 > 0:
    data2 = data2.replace(old, new)
    with open(r'E:\openclaw\murasame\launcher\resources\app_extract\server.js', 'wb') as f:
        f.write(data2)
    print("Fixed app_extract too")
