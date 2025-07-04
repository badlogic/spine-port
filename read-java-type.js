#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
if (args.length < 1) {
    console.error('Usage: ./read-java-type.js <type-name>');
    console.error('Example: ./read-java-type.js Property');
    process.exit(1);
}

const typeName = args[0];

// Read spine-libgdx.json for complete type information
const spineData = JSON.parse(fs.readFileSync('spine-libgdx.json', 'utf8'));

// Helper function to find a type by name recursively
function findType(symbols, typeName) {
    const matches = [];
    
    function search(symbol, parent = null) {
        if (symbol.name === typeName && symbol.kind !== 'package') {
            matches.push({ symbol, parent });
        }
        if (symbol.children) {
            for (const child of symbol.children) {
                search(child, symbol);
            }
        }
    }
    
    for (const symbol of symbols) {
        search(symbol);
    }
    
    return matches;
}

// Find all types with this name
const matches = findType(spineData.symbols, typeName);

if (matches.length === 0) {
    console.error(`Error: Type '${typeName}' not found in spine-libgdx.json`);
    process.exit(1);
}

if (matches.length > 1) {
    console.error(`Error: Multiple types named '${typeName}' found:`);
    matches.forEach(m => {
        console.error(`  - ${m.symbol.file} (${m.symbol.kind})`);
    });
    process.exit(1);
}

const { symbol: typeInfo, parent: parentInfo } = matches[0];
const javaFilePath = typeInfo.file;
const isInner = parentInfo && parentInfo.kind !== 'package';

// Read the Java file
const fileContent = fs.readFileSync(javaFilePath, 'utf8');
const lines = fileContent.split('\n');

// Find inner type ranges if this is a parent class
let innerTypeRanges = [];
if (!isInner && typeInfo.children) {
    for (const child of typeInfo.children) {
        // Skip non-type children (methods, fields, etc)
        if (['class', 'interface', 'enum'].includes(child.kind)) {
            const innerStart = child.range.start.line;
            const innerEnd = child.range.end.line;
            
            // Extend range to include javadoc/annotations before the inner type
            let extendedStart = innerStart;
            for (let i = innerStart - 2; i >= 0; i--) {
                const line = lines[i].trim();
                if (line && !line.startsWith('*') && !line.startsWith('/**') && !line.startsWith('@')) {
                    break;
                }
                if (line.startsWith('/**') || line.startsWith('@')) {
                    extendedStart = i + 1;
                }
            }
            
            innerTypeRanges.push({
                name: child.name,
                start: extendedStart,
                end: innerEnd
            });
        }
    }
}

// Sort inner ranges by start line
innerTypeRanges.sort((a, b) => a.start - b.start);

// Get type's line range from spine-libgdx.json (already 1-based)
const typeStartLine = typeInfo.range.start.line;
const typeEndLine = typeInfo.range.end.line;

// Find the actual start including javadoc
let actualStart = typeStartLine;

// Go backwards to find javadoc start
for (let i = typeStartLine - 2; i >= 0; i--) { // -2 because line numbers are 1-based
    const line = lines[i];
    const trimmed = line.trim();
    
    // If we find the start of javadoc, update our start
    if (trimmed.startsWith('/**')) {
        actualStart = i + 1; // +1 because line numbers are 1-based
        break;
    }
    
    // If we're in javadoc (lines starting with *) or empty line, keep going back
    if (trimmed.startsWith('*') || trimmed === '') {
        // Only update start if we're in javadoc content
        if (trimmed.startsWith('*')) {
            actualStart = i + 1;
        }
    } else if (!trimmed.startsWith('@')) {
        // Stop if we hit a non-empty line that's not javadoc or annotation
        break;
    }
}

// Create skip ranges for inner types and surrounding empty lines
let skipRanges = [];
for (const inner of innerTypeRanges) {
    let skipStart = inner.start;
    let skipEnd = inner.end;
    
    // Look back to find any empty lines before the inner type
    for (let i = inner.start - 2; i >= 0; i--) {
        const line = lines[i].trim();
        if (line === '') {
            skipStart = i + 1;
        } else {
            break;
        }
    }
    
    // Look forward to find any empty lines after the inner type
    for (let i = inner.end; i < lines.length && i < typeEndLine - 1; i++) {
        const line = lines[i].trim();
        if (line === '') {
            skipEnd = i + 1;
        } else {
            break;
        }
    }
    
    skipRanges.push({ 
        start: skipStart, 
        end: skipEnd
    });
}

// Extract the type lines
const result = [];
// Count actual inner types, not skip ranges
let skippedInnerCount = innerTypeRanges.length;
let classIndentation = '';

// Check if we need to include one more line for closing brace
let actualEnd = typeEndLine;
if (actualEnd < lines.length) {
    const nextLine = lines[actualEnd];
    if (nextLine && nextLine.trim() === '}') {
        actualEnd++;
    }
}

for (let i = actualStart - 1; i <= actualEnd - 1 && i < lines.length; i++) {
    const lineNum = i + 1;
    
    // Check if we're in a skip range
    let shouldSkip = false;
    for (const range of skipRanges) {
        if (lineNum >= range.start && lineNum <= range.end) {
            shouldSkip = true;
            break;
        }
    }
    
    if (shouldSkip) {
        continue;
    }
    
    // Capture the indentation of the class/interface/enum declaration
    if (lineNum === typeStartLine) {
        const match = lines[i].match(/^(\s*)/);
        if (match) {
            classIndentation = match[1];
        }
    }
    
    // Add the line with original indentation
    result.push(`${lineNum.toString().padStart(6)}:${lines[i]}`);
}

// Add summary of removed inner classes if any
if (skippedInnerCount > 0) {
    const classText = skippedInnerCount === 1 ? 'class' : 'classes';
    result.push(`\n${classIndentation}\t// ${skippedInnerCount} inner ${classText} removed`);
}

// Output the result
console.log(result.join('\n'));