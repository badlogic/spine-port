# Spine Runtimes Porting Program

Collaborative porting of changes between two commits in the Spine runtime
reference implementation (Java) to a target runtime. Work tracked in
`porting-plan.json` which has the following format.

**Important**: All line and column numbers in porting-plan.json and the spine-xxx.json
files are 1-based (matching what editors and error messages show), not 0-based.

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
          "startLine": 45,    // Line where the type declaration starts (e.g., "public enum Animation {")
          "endLine": 52,      // Line where the type ends (includes closing brace)
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
Use the vs-claude MCP server tools for opening files and diffs for the user
during porting.

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

### Reading Java Types

Extract a type's source code from the current version:

```bash
./read-java-type.js <type-name>

# Example:
./read-java-type.js Property
```

Returns the type's source code with each line prefixed by its line number:
- Exact indentation preserved (including tabs)
- Inner class definitions removed (replaced by count at end of output)
- Includes a summary of excluded inner classes at the end

### Type Diff Analysis

Get an inline diff showing changes to a specific type:

```bash
./read-java-type-diff.js <type-name>

# Example:
./read-java-type-diff.js Property
```

Returns a focused diff of just the specified type:
- Shows only changes to the type itself (excludes inner class changes)
- `+` prefix for added lines
- `-` prefix for removed lines
- Single space prefix for unchanged lines
- No line numbers
- Includes a summary of excluded inner classes at the end

### Compile Testing

For C++, test compile individual files during porting:

```bash
./compile-cpp.js /path/to/spine-cpp/spine-cpp/src/spine/Animation.cpp
```

For other languages, we can not compile individual files and should not try to.

## Workflow

Port one type at a time. Ensure the target runtime implementation is functionally
equivalent to the reference implementation. The APIs must match, bar idiomatic
differences, including type names, field names, method names, enum names,
parameter names and so on. Implementations of methods must match EXACTLY, bar
idiomatic differences, such as differences in collection types.

Follow these steps to port each type:

### 1. Setup (One-time)

DO NOT use the TodoWrite and TodoRead tools for this phase!

1. Read metadata from porting-plan.json:
   ```bash
   jq '.metadata' porting-plan.json
   ```
   - If this fails, abort and tell user to run generate-porting-plan.js
   - Store these values for later use:
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
      - STOP and ask the user for a review

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

2. **Open files in VS Code via vs-claude (for user review):**
   - Open Java file and Java file git diff (from prevBranch to currentBranch) using vs-claude
   - If candidateFiles exists: open all candidate files using vs-claude

3. **Confirm with user:**
   - Ask: "Port this type? (y/n)"
   - STOP and wait for confirmation.

4. **Read source files and analyze changes:**
   - **Read the Java type diff to see current code and changes:**
     ```bash
     ./read-java-type-diff.js <type-name>
     ```
     - If the diff shows only unchanged lines (no `+` or `-` prefixes):
       - Tell user: "No changes detected in <type-name>. Mark as done? (y/n)"
       - If yes, skip to step 6 to update status
       - If no, continue to analyze target files (changes might be needed there)

   - **If type extends/implements others, read parent types:**
     - Check the type declaration for extends/implements
     - Use `./read-java-type.js <parent-type>` for each parent
     - Continue recursively until you have the full inheritance chain

   - **Read target candidateFiles if they exist:**
     - Check porting-plan.json for the candidateFiles array
     - Read each candidate file in full to understand current target implementation

5. **Port the type:**
   - CRITICAL: The goal is 100% functional parity with Java (current branch)
   - Analysis approach:
     * First, understand what the Java implementation currently has (all fields, methods, inner classes)
     * Second, understand what the target implementation currently has
     * Third, identify the delta:
       1. What's in Java but missing from target → ADD
       2. What's in target but not in Java → REMOVE (unless it's idiomatic)
       3. What exists in both but differs → UPDATE to match Java
       4. What's identical → LEAVE ALONE

   - Decision framework for each difference:
     * Is this an idiomatic difference?
       - If yes → Keep target's idiomatic approach but ensure same functionality
     * Is this old functionality that Java removed?
       - If yes → Remove from target
     * Is this new functionality that Java added?
       - If yes → Add to target
     * Is this a behavioral difference?
       - If yes → Update target to match Java behavior exactly

   - Implementation steps:
     * If target file(s) don't exist, create them following conventions
     * Make changes systematically:
       1. Remove obsolete code first
       2. Update existing code (signatures, then implementations)
       3. Add new code last
     * Use MultiEdit for all changes to one file
     * For C++: Run `./compile-cpp.js` after significant changes
     * Update documentation (doxygen/jsdoc) to match Java

   - Verification checklist:
     * All Java public/protected members exist in target
     * No extra public/protected members in target (unless idiomatic)
     * All method behaviors match exactly, especially math heavy code
     * All constants and enums match
     * Memory management is correct in unmanaged languages, e.g. C++
     * The target runtime code follows target language conventions

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
