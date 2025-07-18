#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');

if (process.argv.length < 3) {
    console.error('Usage: compile-cpp.js <cpp-file-path>');
    process.exit(1);
}

const cppFile = process.argv[2];
const spineRuntimesDir = '/Users/badlogic/workspaces/spine-runtimes';
const spineCppInclude = path.join(spineRuntimesDir, 'spine-cpp/include');

try {
    // Compile command with include paths
    const cmd = `g++ -std=c++11 -I"${spineCppInclude}" -c "${cppFile}" -o /tmp/test.o`;

    console.log(`Compiling: ${cppFile}`);
    execSync(cmd, { stdio: 'inherit' });
    console.log('Compilation successful!');
} catch (error) {
    console.error('Compilation failed');
    process.exit(1);
}