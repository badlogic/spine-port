# Spine Runtime Porting Tools

This repository contains tools and workflows for porting changes from the Spine reference implementation (spine-libgdx in Java) to other language runtimes (spine-cpp, spine-ts, spine-haxe, etc.).

## Contents

- `generate-porting-plan.js` - Analyzes git diffs between commits and generates a porting plan
- `port.md` - Detailed workflow guide for the porting process
- `compile-cpp.js` - Helper script for testing C++ compilation during porting

## Purpose

These tools enable systematic, incremental porting of changes between different Spine runtime implementations, ensuring feature parity across all supported languages.

## More Information

For a detailed explanation of the approach and methodology behind these tools, see:
https://mariozechner.at/posts/2025-01-02-prompts-are-code/