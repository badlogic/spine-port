#!/usr/bin/env node --no-warnings

import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ANSI color codes
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m'
};

const c = {
    red: (text) => `${colors.red}${text}${colors.reset}`,
    green: (text) => `${colors.green}${text}${colors.reset}`,
    yellow: (text) => `${colors.yellow}${text}${colors.reset}`,
    blue: (text) => `${colors.blue}${text}${colors.reset}`,
    cyan: (text) => `${colors.cyan}${text}${colors.reset}`,
    gray: (text) => `${colors.gray}${text}${colors.reset}`,
    bold: (text) => `${colors.bright}${text}${colors.reset}`,
    dim: (text) => `${colors.dim}${text}${colors.reset}`
};

const __filename = fileURLToPath(import.meta.url);

// Parse command line arguments
const args = process.argv.slice(2);
if (args.length < 4) {
    console.error('Usage: node generate-porting-plan.js <from-commit> <to-commit> <spine-runtimes-dir> <target-runtime>');
    console.error('Example: node generate-porting-plan.js 4.2 4.3-beta /path/to/spine-runtimes spine-cpp');
    console.error('\nSupported target runtimes: spine-cpp, spine-ts, spine-haxe');
    process.exit(1);
}

const fromCommit = args[0];
const toCommit = args[1];
const spineRuntimesDir = args[2];
const targetRuntime = args[3];

// Validate target runtime
const supportedRuntimes = ['spine-cpp', 'spine-ts', 'spine-haxe'];
if (!supportedRuntimes.includes(targetRuntime)) {
    console.error(`Error: Unsupported target runtime '${targetRuntime}'`);
    console.error(`Supported runtimes: ${supportedRuntimes.join(', ')}`);
    process.exit(1);
}

// Ensure we're in a git repository
try {
    execSync('git rev-parse --git-dir', { cwd: spineRuntimesDir, stdio: 'ignore' });
} catch (error) {
    console.error(`Error: ${spineRuntimesDir} is not a git repository`);
    process.exit(1);
}

// Helper function to run lsp-cli and generate JSON for a runtime
async function generateLspJson(runtimePath, language, outputFile) {
    const runtimeName = path.basename(path.dirname(runtimePath));
    console.log(`\n${c.blue('→')} Processing ${c.bold(runtimeName)}`);
    console.log(`   ${c.gray('Language:')} ${language}`);
    console.log(`   ${c.gray('Path:')} ${c.dim(runtimePath)}`);

    try {
        const startTime = Date.now();

        // Just run the command and let it control the terminal directly
        console.log(); // Add spacing before lsp-cli output

        try {
            execSync(`lsp-cli "${runtimePath}" ${language} "${outputFile}"`, {
                stdio: 'inherit'
            });
        } catch (error) {
            // Error already displayed by lsp-cli
            throw error;
        }

        // Rename llms.md to lsp-cli.md if it exists
        const llmsPath = path.join(process.cwd(), 'llms.md');
        const lspCliPath = path.join(process.cwd(), 'lsp-cli.md');
        if (fs.existsSync(llmsPath)) {
            fs.renameSync(llmsPath, lspCliPath);
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const fileSize = (fs.statSync(outputFile).size / 1024 / 1024).toFixed(2);
        console.log(`   ${c.green('✓')} Generated ${c.cyan(path.basename(outputFile))} ${c.gray(`(${fileSize} MB in ${duration}s)`)}`);
    } catch (error) {
        console.error(`   ${c.red('✗')} Failed: ${error.message}`);
    }
}

// Helper function to find candidate files for a type in target runtime
function findCandidateFiles(targetLsp, typeName) {
    if (!targetLsp) return [];
    
    const candidateFiles = new Set();
    
    // Recursive function to search for type in symbols and their children
    function searchSymbol(symbol) {
        // Check if this symbol matches
        if (symbol.name === typeName && 
            ['class', 'interface', 'enum'].includes(symbol.kind)) {
            // Add declaration file
            candidateFiles.add(symbol.file);
            
            // For C++, also check if there's a definition file
            if (symbol.definition && symbol.definition.file) {
                candidateFiles.add(symbol.definition.file);
            }
            
            // Also check children for methods with definitions
            if (symbol.children) {
                for (const child of symbol.children) {
                    if (child.definition && child.definition.file) {
                        candidateFiles.add(child.definition.file);
                    }
                }
            }
        }
        
        // Search in children
        if (symbol.children) {
            for (const child of symbol.children) {
                searchSymbol(child);
            }
        }
    }
    
    // Search through all top-level symbols
    for (const symbol of targetLsp.symbols) {
        searchSymbol(symbol);
    }
    
    return Array.from(candidateFiles);
}

// Helper function to extract types from Java file using LSP data
function extractTypesFromFile(lspData, filePath) {
    const types = [];

    // Helper function to extract inner types recursively
    function extractInnerTypes(symbol, isInner = false) {
        // Add the current type
        if (['class', 'interface', 'enum'].includes(symbol.kind)) {
            // Extract just the type name, removing generic parameters
            let typeName = symbol.name;
            const genericIndex = typeName.indexOf('<');
            if (genericIndex !== -1) {
                typeName = typeName.substring(0, genericIndex);
            }
            
            types.push({
                name: typeName,
                kind: symbol.kind,
                startLine: symbol.range.start.line,
                endLine: symbol.range.end.line,
                isInner: isInner,
                portingState: 'pending'
            });
        }

        // Process children for inner types
        if (symbol.children) {
            for (const child of symbol.children) {
                if (['class', 'interface', 'enum'].includes(child.kind)) {
                    extractInnerTypes(child, true);
                }
            }
        }
    }

    // Find all top-level symbols in the file
    for (const symbol of lspData.symbols) {
        if (symbol.file === filePath &&
            ['class', 'interface', 'enum'].includes(symbol.kind)) {
            extractInnerTypes(symbol);
        }
    }

    return types;
}

// Main processing
async function main() {
    try {
        console.log(`\n${c.bold('Analyzing changes')} from ${c.cyan(fromCommit)} to ${c.cyan(toCommit)}`);
        console.log(`${c.gray('Spine runtimes directory:')} ${spineRuntimesDir}`);
        console.log(`${c.gray('Target runtime:')} ${c.cyan(targetRuntime)}`);

        // Runtime configuration
        const runtimeConfigs = {
            'spine-cpp': { path: path.join(spineRuntimesDir, 'spine-cpp/spine-cpp'), language: 'cpp' },
            'spine-haxe': { path: path.join(spineRuntimesDir, 'spine-haxe/spine-haxe'), language: 'haxe' },
            'spine-ts': { path: path.join(spineRuntimesDir, 'spine-ts/spine-core'), language: 'typescript' }
        };

        // Generate LSP data for spine-libgdx and target runtime only
        const runtimesToGenerate = [
            { name: 'spine-libgdx', path: path.join(spineRuntimesDir, 'spine-libgdx/spine-libgdx/src'), language: 'java' },
            { name: targetRuntime, ...runtimeConfigs[targetRuntime] }
        ];
        console.log(`Generating lsp-cli.md...`)
        execSync(`lsp-cli --llm`);

        console.log(`\n${c.bold('Generating LSP data...')}`);
        console.log(c.gray('─'.repeat(60)));

        for (const runtime of runtimesToGenerate) {
            const outputFile = path.join(process.cwd(), `${runtime.name}.json`);
            if (fs.existsSync(runtime.path)) {
                await generateLspJson(runtime.path, runtime.language, outputFile);
            } else {
                console.log(`\n${c.blue('→')} Processing ${c.bold(runtime.name)}`);
                console.log(`   ${c.red('✗')} Runtime path not found: ${c.dim(runtime.path)}`);
            }
        }

        console.log('\n' + c.gray('─'.repeat(60)));

        // Load the spine-libgdx LSP data for type extraction
        console.log(`\n${c.blue('→')} Loading spine-libgdx LSP data for type extraction...`);
        let spineLibgdxLsp = null;
        const libgdxLspPath = path.join(process.cwd(), 'spine-libgdx.json');
        if (fs.existsSync(libgdxLspPath)) {
            try {
                spineLibgdxLsp = JSON.parse(fs.readFileSync(libgdxLspPath, 'utf8'));
                console.log(`   ${c.green('✓')} Loaded ${c.cyan(spineLibgdxLsp.symbols.length)} symbols`);
            } catch (error) {
                console.error(`   ${c.yellow('⚠')} Warning: Could not parse spine-libgdx.json: ${error.message}`);
            }
        } else {
            console.log(`   ${c.yellow('⚠')} spine-libgdx.json not found`);
        }

        // Load the target runtime LSP data for finding candidates
        console.log(`\n${c.blue('→')} Loading ${targetRuntime} LSP data for candidate detection...`);
        let targetLsp = null;
        const targetLspPath = path.join(process.cwd(), `${targetRuntime}.json`);
        if (fs.existsSync(targetLspPath)) {
            try {
                targetLsp = JSON.parse(fs.readFileSync(targetLspPath, 'utf8'));
                console.log(`   ${c.green('✓')} Loaded ${c.cyan(targetLsp.symbols.length)} symbols`);
            } catch (error) {
                console.error(`   ${c.yellow('⚠')} Warning: Could not parse ${targetRuntime}.json: ${error.message}`);
            }
        } else {
            console.log(`   ${c.yellow('⚠')} ${targetRuntime}.json not found`);
        }

        // Get list of changed Java files in spine-libgdx
        console.log(`\n${c.blue('→')} Analyzing git changes...`);
        const gitCommand = `git diff --name-status ${fromCommit}..${toCommit} -- spine-libgdx/spine-libgdx/src/com/esotericsoftware/spine/`;
        const gitOutput = execSync(gitCommand, { cwd: spineRuntimesDir, encoding: 'utf8' });

        const portingOrder = [];
        const deletedFiles = [];

        // Process each changed file
        const lines = gitOutput.trim().split('\n').filter(line => line);

        for (const line of lines) {
            const [status, ...pathParts] = line.split(/\s+/);
            const relativePath = pathParts.join(' ');
            const absolutePath = path.join(spineRuntimesDir, relativePath);

            if (status === 'D') {
                // Deleted file
                deletedFiles.push({
                    filePath: absolutePath,
                    status: 'pending'
                });
            } else if ((status === 'A' || status === 'M') && relativePath.endsWith('.java')) {
                // Added or modified Java file
                const entry = {
                    javaSourcePath: absolutePath
                };

                // Extract types if LSP data is available
                if (spineLibgdxLsp) {
                    const types = extractTypesFromFile(spineLibgdxLsp, absolutePath);
                    if (types.length > 0) {
                        // Sort types: enums first, then interfaces, then classes
                        const typeOrder = { 'enum': 0, 'interface': 1, 'class': 2 };
                        types.sort((a, b) => {
                            const orderDiff = typeOrder[a.kind] - typeOrder[b.kind];
                            if (orderDiff !== 0) return orderDiff;
                            // If same kind, sort by name
                            return a.name.localeCompare(b.name);
                        });
                        
                        // Find candidate files for each type
                        types.forEach(type => {
                            type.candidateFiles = findCandidateFiles(targetLsp, type.name);
                            type.portingState = 'pending';
                        });
                        
                        entry.types = types;
                    }
                }

                portingOrder.push(entry);
            }
        }

        // Sort files by type content and count
        const typeOrder = { 'enum': 0, 'interface': 1, 'class': 2 };

        portingOrder.sort((a, b) => {
            const aTypes = a.types?.length || 0;
            const bTypes = b.types?.length || 0;

            // First sort by number of types
            if (aTypes !== bTypes) return aTypes - bTypes;

            // For files with the same number of types
            if (aTypes === 1 && bTypes === 1) {
                // For single-type files, sort by type kind (enum < interface < class)
                const aKind = a.types[0].kind;
                const bKind = b.types[0].kind;
                const kindDiff = typeOrder[aKind] - typeOrder[bKind];
                if (kindDiff !== 0) return kindDiff;
            }

            // If same number and kinds of types, sort by file path
            return a.javaSourcePath.localeCompare(b.javaSourcePath);
        });

        // Get target runtime config
        const targetConfig = runtimeConfigs[targetRuntime];

        // Create the PortingPlan structure
        const portingPlan = {
            metadata: {
                prevBranch: fromCommit,
                currentBranch: toCommit,
                generated: new Date().toISOString(),
                spineRuntimesDir: path.resolve(spineRuntimesDir),
                targetRuntime: targetRuntime,
                targetRuntimePath: path.resolve(targetConfig.path),
                targetRuntimeLanguage: targetConfig.language
            },
            deletedFiles,
            portingOrder
        };

        // Write to porting-plan.json
        const outputPath = path.join(process.cwd(), 'porting-plan.json');
        fs.writeFileSync(outputPath, JSON.stringify(portingPlan, null, 2));

        console.log();
        console.log(c.bold('Summary'));
        console.log(c.gray('─'.repeat(40)));
        console.log(`  Files to port: ${c.green(portingOrder.length)}`);
        console.log(`  Deleted files: ${c.yellow(deletedFiles.length)}`);

        // Count types if available
        const totalTypes = portingOrder.reduce((sum, file) => sum + (file.types?.length || 0), 0);
        if (totalTypes > 0) {
            console.log(`  Types to port: ${c.cyan(totalTypes)}`);

            // Break down by type and inner/outer
            const typeBreakdown = { class: 0, interface: 0, enum: 0 };
            let innerCount = 0;

            portingOrder.forEach(file => {
                file.types?.forEach(type => {
                    if (typeBreakdown.hasOwnProperty(type.kind)) {
                        typeBreakdown[type.kind]++;
                    }
                    if (type.isInner) {
                        innerCount++;
                    }
                });
            });

            console.log(c.gray(`    Classes: ${typeBreakdown.class}`));
            console.log(c.gray(`    Interfaces: ${typeBreakdown.interface}`));
            console.log(c.gray(`    Enums: ${typeBreakdown.enum}`));
            if (innerCount > 0) {
                console.log(c.gray(`    Inner types: ${innerCount}`));
            }
        }
        console.log(c.gray('─'.repeat(40)));

        console.log(`\n${c.green('✓')} Output written to: ${c.cyan(outputPath)}`);

    } catch (error) {
        console.error(`\n${c.red('✗ Error:')} ${error.message}`);
        process.exit(1);
    }
}

// Run the main function
main();