#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

// Check if file path is provided
if (process.argv.length < 3) {
    console.log("Usage: compile_single.js <absolute_file_path>");
    console.log("Example: compile_single.js /Users/badlogic/workspaces/spine-runtimes/spine-cpp/spine-cpp/src/spine/Skeleton.cpp");
    process.exit(1);
}

// Get the absolute file path
const sourceFile = process.argv[2];

// Check if file exists
if (!fs.existsSync(sourceFile)) {
    console.error(`Error: File not found: ${sourceFile}`);
    process.exit(1);
}

// Get spine-runtimes directory from porting-plan.json
let spineRuntimesDir;
try {
    const portingPlan = JSON.parse(fs.readFileSync('porting-plan.json', 'utf8'));
    spineRuntimesDir = portingPlan.metadata?.spineRuntimesDir;
    if (!spineRuntimesDir) throw new Error("Missing spineRuntimesDir");
} catch (e) {
    console.error("Error: Could not read spineRuntimesDir from porting-plan.json");
    process.exit(1);
}

// Compile command
const compileCmd = `clang++ -std=c++11 -Wno-inconsistent-missing-override -c -I"${spineRuntimesDir}/spine-cpp/spine-cpp/include" "${sourceFile}" -o /tmp/test.o 2>&1`;

try {
    // Execute and capture output
    execSync(compileCmd);
    console.log("✅ Compilation successful!");
} catch (error) {
    // Parse compiler output to extract first error
    const output = error.stdout?.toString() || error.toString();
    const lines = output.split('\n');

    let errorStart = -1;
    let errorEnd = -1;
    let inError = false;
    let noteCount = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Detect start of an error
        if (line.includes(': error:') && errorStart === -1) {
            errorStart = i;
            inError = true;
            noteCount = 0;
        }

        // Track notes that belong to the error
        if (inError && line.includes(': note:')) {
            noteCount++;
            errorEnd = i;
        }

        // Detect when we've moved past the current error
        if (inError && !line.trim() && noteCount > 0) {
            errorEnd = i;
            break;
        }

        // If we hit another error, stop at the previous line
        if (inError && errorStart !== i && line.includes(': error:')) {
            errorEnd = i - 1;
            break;
        }

        // Handle case where error has no notes
        if (inError && errorStart !== -1 && i > errorStart && !line.startsWith(' ') && !line.includes(': note:')) {
            if (!line.includes(': error:')) {
                errorEnd = i - 1;
                break;
            }
        }
    }

    // If we only found the start, show just that line
    if (errorStart !== -1 && errorEnd === -1) {
        errorEnd = errorStart;
    }

    // Print the first error
    if (errorStart !== -1) {
        for (let i = errorStart; i <= errorEnd && i < lines.length; i++) {
            console.log(lines[i]);
        }
    } else {
        // Fallback: just show first 20 lines if we can't parse
        console.log("Compilation failed:");
        console.log(lines.slice(0, 20).join('\n'));
    }
}
