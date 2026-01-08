# Deep Research: Decoding Antigravity Session Protobuf Files

## Context

Antigravity (Google's fork of VSCode/Windsurf) stores conversation sessions as `.pb` files in `~/.gemini/antigravity/conversations/`. There are 66 files totaling ~387MB.

## File Characteristics

```
Magic bytes: 53 d1 42 f7 79 18 81 c0 27 bc b0 38 0f ce 2a 76
File type: "data" (not recognized compression)
One file type: "OpenPGP Public Key" (different format?)
```

The bytes don't match:
- gzip (1f 8b)
- zstd (28 b5 2f fd)
- snappy (ff 06 00 00)
- raw protobuf (usually starts with field tags)

## Known Architecture

From HAR file analysis:
- gRPC API uses `exa.language_server_pb` and `exa.extension_server_pb` protos
- `StreamCascadeReactiveUpdates` endpoint streams session content
- Local `language_server` binary handles decryption (running on 127.0.0.1:43405)
- MIME type: `application/connect+proto`

## Research Questions

1. **What encryption scheme does Antigravity use for local session storage?**
   - Is it tied to Google account OAuth token?
   - Is there a local key stored in `~/.config/Antigravity/`?
   - Could it use Electron's safeStorage API?

2. **Where is the protobuf schema defined?**
   - Are `.proto` files embedded in the Antigravity binary?
   - Can they be extracted from `workbench.desktop.main.js`?
   - Are they published in any Google repository?

3. **How does `language_server_linux_x64` decrypt the .pb files?**
   - What crypto libraries does it link against?
   - Can the decryption be intercepted with LD_PRELOAD?
   - Can Frida be used to hook the decrypt function?

4. **Are there any existing tools or projects that have reverse-engineered this format?**
   - GitHub repos
   - Security research papers
   - Forum threads about Antigravity/Cascade internals

5. **What's the relationship between "Cascade" and Antigravity?**
   - Cascade appears in API names (StreamCascadeReactiveUpdates)
   - Is Cascade the codename for the AI agent system?
   - Are there public docs about Cascade's data format?

## Desired Output

1. Steps to extract/decode session content from `.pb` files
2. Protobuf schema (even partial) for session messages
3. Key derivation method if encryption is used
4. Python or JavaScript script to decode sessions offline

## Technical Constraints

- Must work offline (no running Antigravity UI)
- Can use any available tools (protoscope, blackboxprotobuf, frida, etc.)
- Solution should be scriptable for batch processing
