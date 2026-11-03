# Example Directory

This directory contains example usage of the Labs SDK.

## Building Examples

After building the main SDK, you can copy the built files to this directory using the Makefile:

```bash
# Copy built SDK files to example/dist
make copy-dist

# Clean the example/dist directory
make clean

# Default target (same as copy-dist)
make
```

## Manual Copy (Alternative)

If you prefer not to use make, you can manually copy the files:

```bash
mkdir -p example/dist
cp ../dist/labs-sdk-dev.js example/dist/
cp ../dist/labs-sdk-prod.js example/dist/
```

## Files

- `html/script-tag.html` - Example HTML page demonstrating SDK usage
- `dist/` - Directory containing copied SDK build files (created by make)
