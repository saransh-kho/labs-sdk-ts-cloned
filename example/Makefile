# Example directory build script
# This script copies the built SDK files to the example directory
# Run this after the main SDK build is complete

.PHONY: copy-dist clean

# Copy the built SDK files to example/dist
copy-dist:
	@echo "Copying built SDK files to example/dist..."
	@mkdir -p dist
	@cp ../dist/labs-sdk-dev.js dist/
	@cp ../dist/labs-sdk-prod.js dist/
	@echo "✅ SDK files copied successfully"

# Clean the example/dist directory
clean:
	@echo "Cleaning example/dist directory..."
	@rm -rf dist
	@echo "✅ Example dist directory cleaned"

# Default target
all: copy-dist