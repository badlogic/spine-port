# Spine Runtimes Porting Guide v2

Collaborative porting of Spine Runtime skeletal animation library from Java to target runtime. Work tracked in `porting-plan.json` which has the following format:

```json
{
  "metadata": {
    "prevBranch": "4.2",
    "currentBranch": "4.3-beta",
    "generated": "2024-06-30T...",
    "spineRuntimesDir": "/absolute/path/to/spine-runtimes",
    "targetRuntime": "spine-cpp",
    "targetRuntimePath": "/absolute/path/to/spine-runtimes/spine-cpp/spine-cpp",
    "targetRuntimeLanguage": "cpp"
  },
  "deletedFiles": [
    {
      "filePath": "/path/to/deleted/File.java",
      "status": "pending"
    }
  ],
  "portingOrder": [
    {
      "javaSourcePath": "/path/to/EnumFile.java",
      "types": [
        {
          "name": "MixBlend",
          "kind": "enum",
          "startLine": 45,
          "endLine": 52,
          "isInner": false,
          "portingState": "pending"
        }
      ]
    }
  ]
}
```
## Tools

### VS Claude
Use the vs-claude MCP server tools for opening files and diffs for the user during porting.

```javascript
// Open multiple files at once (batch operations)
mcp__vs-claude__open([
  {"type": "file", "path": "/abs/path/Animation.java"},    // Java source
  {"type": "file", "path": "/abs/path/Animation.h"},       // C++ header
  {"type": "file", "path": "/abs/path/Animation.cpp"}      // C++ source
]);

// Open single file with line range
mcp__vs-claude__open({"type": "file", "path": "/abs/path/Animation.java", "startLine": 100, "endLine": 120});

// View git diff for a file
mcp__vs-claude__open({"type": "gitDiff", "path": "/abs/path/Animation.cpp", "from": "HEAD", "to": "working"});
```

### LSP JSON Files

Use spine-libgdx.json and spine-[target].json to navigate directly to types without searching.

You MUST read lsp-cli.md to understand the format of these files!

Examples:
```bash
# Find type location in Java reference
jq -r --arg t "Animation" '.symbols[] | select(.name == $t) | "\(.file):\(.range.start.line + 1)-\(.range.end.line + 1)"' spine-libgdx.json

# Find type location in target runtime
jq -r --arg t "Animation" '.symbols[] | select(.name == $t) | "\(.file):\(.range.start.line + 1)-\(.range.end.line + 1)"' spine-cpp.json

# Get all methods of a type
jq -r --arg t "Animation" '.symbols[] | select(.name == $t) | .children[]? | select(.kind == "method") | .name' spine-libgdx.json

# Compare methods between Java and target
diff <(jq -r --arg t "Animation" '.symbols[] | select(.name == $t) | .children[]? | select(.kind == "method") | .name' spine-libgdx.json | sort) \
     <(jq -r --arg t "Animation" '.symbols[] | select(.name == $t) | .children[]? | select(.kind == "method") | .name' spine-cpp.json | sort)

# Check if type exists in target
jq -r --arg t "MixBlend" '.symbols[] | select(.name == $t) | .name' spine-cpp.json || echo "Type not found"

# Find inner types (since they have isInner flag in porting-plan but not in LSP)
jq -r '.symbols[] | select(.children[]? | select(.kind | IN("class", "interface", "enum"))) | .children[] | select(.kind | IN("class", "interface", "enum")) | .name' spine-libgdx.json
```

You MUST use `jq` queries on these files instead of grep or ripgrep to minimize the number of turns you need, and the number of tokens in your context.

### Compile Testing

For C++, test compile individual files during porting:

```bash
./compile_cpp.js /path/to/spine-cpp/spine-cpp/src/spine/Animation.cpp
```

For other languages, we can not compile individual files and should not try to.

## Workflow

Port one type at a time. Ensure the target runtime implementation is functionally equivalent to the reference implementation. The APIs must match, bar idiomatic differences, including type names, field names, method names, enum names, parameter names and so on. Implementations of methods must match EXACTLY, bar idiomatic differences, such as differences in collection types.

Follow these steps to port each type:

### 1. Setup (One-time)

1. Read metadata from porting-plan.json:
   ```bash
   jq '.metadata' porting-plan.json
   ```
   If this fails, abort and tell user to run generate-porting-plan.js

   Store these values for later use:
   - targetRuntime (e.g., "spine-cpp")
   - targetRuntimePath (e.g., "/path/to/spine-cpp/spine-cpp")
   - targetRuntimeLanguage (e.g., "cpp")

2. Check for conventions file:
   - Read `${targetRuntime}-conventions.md` (from step 1) in full.
   - If missing:
      - Use Task agents to analyze targetRuntimePath (from step 1)
      - Document all coding patterns and conventions:
         * Class/interface/enum definition syntax
         * Member variable naming (prefixes like m_, _, etc.)
         * Method naming conventions (camelCase vs snake_case)
         * Inheritance syntax
         * File organization (single file vs header/implementation)
         * Namespace/module/package structure
         * Memory management (GC, manual, smart pointers)
         * Error handling (exceptions, error codes, Result types)
         * Documentation format (Doxygen, JSDoc, etc.)
         * Type system specifics (generics, templates)
         * Property/getter/setter patterns
   - Agents MUST use ripgrep instead of grep!
   - Save as ${TARGET}-conventions.md

3. Read `porting-notes.md`in full
   - If missing create with content:
     ```markdown
     # Porting Notes
     ```

### 2. Port Types (Repeat for each)

1. **Find next pending type:**
   ```bash
   # Get next pending type info
   jq -r '.portingOrder[] | {file: .javaSourcePath, types: .types[] | select(.portingState == "pending")} | "\(.file)|\(.types.name)|\(.types.kind)|\(.types.startLine)|\(.types.endLine)"' porting-plan.json | head -1
   ```

   Then locate in target runtime:
   ```bash
   # Replace TYPE_NAME with actual type name from above
   jq -r --arg t "TYPE_NAME" '(.symbols[] | select(.name == $t) | .file), (.symbols[] | .. | objects | select(.name? == $t) | .file) | select(.) | unique[]' spine-cpp.json
   ```

2. **Open files in VS Code:**
   - If TARGET_FILES is empty: Open just Java file at line range
   - If TARGET_FILES exists: Batch open Java + target files
   - For C++: May have both .h and .cpp files

3. **Confirm with user:**
   - Ask: "Port this type? (y/n)"
   - STOP and wait for confirmation.

4. **Read source files:**
   - Java: Read the ENTIRE file containing the type (for full context)
   - Target: If exists, read the ENTIRE file(s)
   - For large files (>2000 lines): Read in chunks of 1000 lines
   - Read parent types if needed (check extends/implements)
   - Goal: Have complete files in context for accurate porting

5. **Port the type:**
   - Follow conventions from ${targetRuntime}-conventions.md
   - For C++: Create .h/.cpp if missing
   - Port incrementally:
     * Structure first (fields, method signatures)
     * Then method implementations
     * For C++: Run `./compile_cpp.js` after each method
   - Use MultiEdit for all changes to one file
   - Ensure 100% functional parity

6. **Get user confirmation:**
   - Show what was ported
   - Ask: "Mark as done? (y/n)"
   - If yes, update status:
   ```bash
   jq --arg file "path/to/file.java" --arg type "TypeName" \
      '(.portingOrder[] | select(.javaSourcePath == $file) | .types[] | select(.name == $type) | .portingState) = "done"' \
      porting-plan.json > tmp.json && mv tmp.json porting-plan.json
   ```

7. **Update porting-notes.md:**
   - Add any new patterns or special cases discovered.

8. **STOP and confirm:**
   - Show what was ported. Ask: "Continue to next type? (y/n)"
   - Only proceed after confirmation.
