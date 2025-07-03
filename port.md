# Spine Runtimes Porting Guide v2

Collaborative porting of changes between two commits in the Spine runtime reference implementation (Java) to a target runtime. Work tracked in `porting-plan.json` which has the following format:

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
          "name": "Animation",
          "kind": "enum",
          "startLine": 45,
          "endLine": 52,
          "isInner": false,
          "portingState": "pending",
          "candidateFiles": ["/path/to/spine-cpp/include/spine/Animation.h", "/path/to/spine-cpp/include/spine/Animation.cpp"]
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

### Progress Tracking

Monitor porting progress using these jq commands:

```bash
# Get overall progress percentage
jq -r '.portingOrder | map(.types[]) | "\(([.[] | select(.portingState == "done")] | length)) types ported out of \(length) total (\(([.[] | select(.portingState == "done")] | length) * 100 / length | floor)% complete)"' porting-plan.json

# Count types by state
jq -r '.portingOrder | map(.types[]) | group_by(.portingState) | map({state: .[0].portingState, count: length}) | sort_by(.state)' porting-plan.json

# List all completed types
jq -r '.portingOrder | map(.types[] | select(.portingState == "done") | .name) | sort | join(", ")' porting-plan.json

# Find remaining types to port
jq -r '.portingOrder | map(.types[] | select(.portingState == "pending") | .name) | length' porting-plan.json
```

### Compile Testing

For C++, test compile individual files during porting:

```bash
./compile-cpp.js /path/to/spine-cpp/spine-cpp/src/spine/Animation.cpp
```

For other languages, we can not compile individual files and should not try to.

## Workflow

Port one type at a time. Ensure the target runtime implementation is functionally equivalent to the reference implementation. The APIs must match, bar idiomatic differences, including type names, field names, method names, enum names, parameter names and so on. Implementations of methods must match EXACTLY, bar idiomatic differences, such as differences in collection types.

Follow these steps to port each type:

### 1. Setup (One-time)

DO NOT use the TodoWrite and TodoRead tools for this phase!

1. Read metadata from porting-plan.json:
   ```bash
   jq '.metadata' porting-plan.json
   ```
   If this fails, abort and tell user to run generate-porting-plan.js

   Store these values for later use:
   - targetRuntime (e.g., "spine-cpp")
   - targetRuntimePath (e.g., "/path/to/spine-cpp/spine-cpp")
   - targetRuntimeLanguage (e.g., "cpp")

2. In parallel
   a. Check for conventions file:
      - Read `${targetRuntime}-conventions.md` (from step 1) in full.
      - If missing:
         - Use Task agents in parallel to analyze targetRuntimePath (from step 1)
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

   b. Read `porting-notes.md` in full
      - If missing create with content:
      ```markdown
      # Porting Notes
      ```

### 2. Port Types (Repeat for each)

1. **Find next pending type:**
   ```bash
   # Get next pending type info with candidate files
   jq -r '.portingOrder[] | {file: .javaSourcePath, types: .types[] | select(.portingState == "pending")} | "\(.file)|\(.types.name)|\(.types.kind)|\(.types.startLine)|\(.types.endLine)|\(.types.candidateFiles | join(","))"' porting-plan.json | head -1
   ```

   The candidateFiles array is already populated by generate-porting-plan.js

2. **Open files in VS Code via vs-claude (for user review):**
   - Open Java file and Java file git diff (from prevBranch to currentBranch)
   - If candidateFiles exists: open all candidate files

3. **Confirm with user:**
   - Ask: "Port this type? (y/n)"
   - STOP and wait for confirmation.

4. **Read source files:**
   - Note: Read the files in parallel if possible
   - Java: Read the ENTIRE file so it is fully in your context!
   - Target: If exists, read the ENTIRE file(s) so they are fully in your context!
   - For large files (>2000 lines): Read in chunks of 1000 lines
   - Read parent types if needed (check extends/implements)
   - Goal: Have complete files in context for accurate porting

5. **Port the type:**
   - Follow conventions from ${targetRuntime}-conventions.md
   - If target file(s) don't exist, create them and open them for the user via vs-claude
   - Port incrementally and always ultrathink:
     * Base on the full content of the files in your context, identify differences and changes that need to be made.
      * differences can be due to idiomatic differences, or real differences due to new or changed functionality in the reference
        implementation. Ultrathink to discern which is which.
     * If changes need to be made:
       * Structure first (fields, method signatures)
       * Then method implementations
       * For C++: Run `./compile-cpp.js` after each method
   - Use MultiEdit for all changes to one file
   - Ensure 100% functional parity
   - Add or update jsdoc, doxygen, etc. based on Javadocs.

6. **Get user confirmation:**
   - Open a diff of the files you modified, comparing HEAD to working.
   - Give the user a summary of what you ported
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
