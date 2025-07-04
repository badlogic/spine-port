#!/usr/bin/env node

const fs = require('fs');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
if (args.length < 1) {
    console.error('Usage: ./read-java-type-diff.js <type-name>');
    console.error('Example: ./read-java-type-diff.js Property');
    process.exit(1);
}

const typeName = args[0];

// Read the LSP data files
const oldLspData = JSON.parse(fs.readFileSync('spine-libgdx-old.json', 'utf8'));
const newLspData = JSON.parse(fs.readFileSync('spine-libgdx.json', 'utf8'));

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

// Find the type in both old and new data
const oldMatches = findType(oldLspData.symbols, typeName);
const newMatches = findType(newLspData.symbols, typeName);

if (newMatches.length === 0) {
    console.error(`Error: Type '${typeName}' not found in current version`);
    process.exit(1);
}

if (newMatches.length > 1) {
    console.error(`Error: Multiple types named '${typeName}' found:`);
    newMatches.forEach(m => {
        console.error(`  - ${m.symbol.file} (${m.symbol.kind})`);
    });
    process.exit(1);
}

const newType = newMatches[0].symbol;
const oldType = oldMatches.length > 0 ? oldMatches[0].symbol : null;

// Read porting plan for git branch info
const portingPlan = JSON.parse(fs.readFileSync('porting-plan.json', 'utf8'));
const { prevBranch, currentBranch, spineRuntimesDir } = portingPlan.metadata;

// Get file path
const javaFilePath = newType.file;
const relativePath = javaFilePath.replace(spineRuntimesDir + '/', '');

// Get both versions of the file
let oldContent, newContent;
try {
    oldContent = execSync(`git -C "${spineRuntimesDir}" show ${prevBranch}:${relativePath}`, 
        { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).split('\n');
} catch (error) {
    // File might not exist in old version
    oldContent = [];
}

try {
    newContent = execSync(`git -C "${spineRuntimesDir}" show ${currentBranch}:${relativePath}`, 
        { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).split('\n');
} catch (error) {
    console.error(`Error getting current version: ${error.message}`);
    process.exit(1);
}

// Helper to extract type content with javadoc, excluding inner types
function extractTypeContent(content, typeInfo, isOld = false) {
    if (!typeInfo || content.length === 0) return [];
    
    let startLine = typeInfo.range.start.line;
    let endLine = typeInfo.range.end.line;
    
    // Extend start to include javadoc
    for (let i = startLine - 2; i >= 0; i--) {
        const line = content[i] || '';
        const trimmed = line.trim();
        
        if (trimmed.startsWith('/**')) {
            startLine = i + 1;
            break;
        }
        
        if (!trimmed.startsWith('*') && trimmed !== '' && !trimmed.startsWith('@')) {
            break;
        }
        
        if (trimmed.startsWith('*') || trimmed.startsWith('@')) {
            startLine = i + 1;
        }
    }
    
    // Get inner type ranges to exclude
    const innerRanges = [];
    if (typeInfo.children) {
        for (const child of typeInfo.children) {
            if (['class', 'interface', 'enum'].includes(child.kind)) {
                // Extend range to include javadoc before inner type
                let innerStart = child.range.start.line;
                for (let i = innerStart - 2; i >= 0; i--) {
                    const line = content[i] || '';
                    const trimmed = line.trim();
                    if (trimmed === '') {
                        innerStart = i + 1;
                    } else if (!trimmed.startsWith('*') && !trimmed.startsWith('/**') && !trimmed.startsWith('@')) {
                        break;
                    } else if (trimmed.startsWith('/**') || trimmed.startsWith('@')) {
                        innerStart = i + 1;
                    }
                }
                
                // Extend range to include empty lines after inner type
                let innerEnd = child.range.end.line;
                for (let i = innerEnd; i < endLine && i < content.length; i++) {
                    const line = content[i] || '';
                    if (line.trim() === '') {
                        innerEnd = i + 1;
                    } else {
                        break;
                    }
                }
                
                innerRanges.push({
                    start: innerStart,
                    end: innerEnd
                });
            }
        }
    }
    
    // Sort inner ranges by start line
    innerRanges.sort((a, b) => a.start - b.start);
    
    // Extract lines, skipping inner types
    const result = [];
    let skipUntil = -1;
    
    for (let i = startLine - 1; i < endLine && i < content.length; i++) {
        const lineNum = i + 1;
        
        // Check if we're entering an inner type range
        for (const range of innerRanges) {
            if (lineNum >= range.start && lineNum <= range.end) {
                skipUntil = range.end;
                break;
            }
        }
        
        // Skip if we're in an inner type
        if (lineNum <= skipUntil) {
            continue;
        }
        
        result.push({
            lineNum: lineNum,
            content: content[i]
        });
    }
    
    // Add a note about removed inner types if any
    if (innerRanges.length > 0) {
        const count = innerRanges.length;
        const classText = count === 1 ? 'class' : 'classes';
        const lastLine = result[result.length - 1];
        const indentMatch = lastLine ? lastLine.content.match(/^(\s*)/) : [''];
        const indent = indentMatch[0];
        result.push({
            lineNum: -1, // Special marker for summary line
            content: `${indent}// ${count} inner ${classText} excluded from diff`
        });
    }
    
    return result;
}

// Extract type content from both versions
const oldTypeContent = oldType ? extractTypeContent(oldContent, oldType, true) : [];
const newTypeContent = extractTypeContent(newContent, newType);

// If type doesn't exist in old version
if (oldTypeContent.length === 0) {
    console.log(`Type '${typeName}' is new in ${currentBranch}`);
    newTypeContent.forEach(line => {
        if (line.lineNum === -1) {
            console.log(`\n${line.content}`);
        } else {
            console.log(`+ ${line.content}`);
        }
    });
    process.exit(0);
}

// Now perform a diff on just the type content
// Using a simple approach - could be improved with a proper diff algorithm
let oldIndex = 0;
let newIndex = 0;

// Create maps of content to line numbers for matching
const oldContentMap = new Map();
const newContentMap = new Map();

oldTypeContent.forEach((line, idx) => {
    if (!oldContentMap.has(line.content)) {
        oldContentMap.set(line.content, []);
    }
    oldContentMap.get(line.content).push(idx);
});

newTypeContent.forEach((line, idx) => {
    if (!newContentMap.has(line.content)) {
        newContentMap.set(line.content, []);
    }
    newContentMap.get(line.content).push(idx);
});

// Track which lines have been matched
const oldMatched = new Array(oldTypeContent.length).fill(false);
const newMatched = new Array(newTypeContent.length).fill(false);

// First pass: exact matches
for (let i = 0; i < newTypeContent.length; i++) {
    const newLine = newTypeContent[i];
    if (oldContentMap.has(newLine.content)) {
        const oldIndices = oldContentMap.get(newLine.content);
        for (const oldIdx of oldIndices) {
            if (!oldMatched[oldIdx]) {
                oldMatched[oldIdx] = true;
                newMatched[i] = true;
                break;
            }
        }
    }
}

// Output the diff
let i = 0, j = 0;
while (i < oldTypeContent.length || j < newTypeContent.length) {
    // Handle special summary lines
    if (i < oldTypeContent.length && oldTypeContent[i].lineNum === -1) {
        // Skip summary line in old content
        i++;
        continue;
    }
    if (j < newTypeContent.length && newTypeContent[j].lineNum === -1) {
        // Output summary line without prefix
        console.log(`\n${newTypeContent[j].content}`);
        j++;
        continue;
    }
    
    // Handle remaining old lines (deletions)
    if (j >= newTypeContent.length || (i < oldTypeContent.length && !oldMatched[i])) {
        console.log(`- ${oldTypeContent[i].content}`);
        i++;
    }
    // Handle remaining new lines (additions)
    else if (i >= oldTypeContent.length || (j < newTypeContent.length && !newMatched[j])) {
        console.log(`+ ${newTypeContent[j].content}`);
        j++;
    }
    // Matched lines
    else {
        console.log(` ${newTypeContent[j].content}`);
        i++;
        j++;
    }
}