#!/bin/bash
set -e

# Build API Release Package
# Creates a standalone tarball of @actual-app/api with bundled dependencies

echo "🔨 Building Actual API release package..."

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_DIR="$ROOT_DIR/build-release"
API_DIR="$ROOT_DIR/packages/api"
CRDT_DIR="$ROOT_DIR/packages/crdt"

# Clean build directory
echo "🧹 Cleaning build directory..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/package"

# Step 1: Build CRDT package
echo "📦 Building @actual-app/crdt..."
cd "$CRDT_DIR"
yarn build

# Step 2: Build API package
echo "📦 Building @actual-app/api..."
cd "$API_DIR"
yarn build

# Step 3: Copy API package files
echo "📋 Copying API package files..."
cp -r "$API_DIR/dist" "$BUILD_DIR/package/"
cp -r "$API_DIR/@types" "$BUILD_DIR/package/"
cp "$API_DIR/README.md" "$BUILD_DIR/package/" 2>/dev/null || echo "No README found"

# Step 4: Copy CRDT package into node_modules
echo "📋 Copying CRDT package..."
mkdir -p "$BUILD_DIR/package/node_modules/@actual-app/crdt"
cp -r "$CRDT_DIR/dist" "$BUILD_DIR/package/node_modules/@actual-app/crdt/"
cp "$CRDT_DIR/package.json" "$BUILD_DIR/package/node_modules/@actual-app/crdt/"

# Step 5: Create modified package.json
echo "📝 Creating package.json..."
cd "$BUILD_DIR/package"

# Read version from source package.json
VERSION=$(node -p "require('$API_DIR/package.json').version")

# Create new package.json with bundled CRDT and its dependencies
cat > package.json << EOF
{
  "name": "@actual-app/api",
  "version": "$VERSION",
  "license": "MIT",
  "description": "An API for Actual Budget (with income forecast)",
  "engines": {
    "node": ">=20"
  },
  "main": "dist/index.js",
  "types": "@types/index.d.ts",
  "files": [
    "dist",
    "@types",
    "node_modules"
  ],
  "dependencies": {
    "better-sqlite3": "^12.2.0",
    "compare-versions": "^6.1.1",
    "google-protobuf": "^3.21.4",
    "murmurhash": "^2.0.1",
    "node-fetch": "^3.3.2",
    "uuid": "^11.1.0"
  },
  "bundledDependencies": [
    "@actual-app/crdt"
  ]
}
EOF

# Step 6: Create tarball
echo "📦 Creating tarball..."
cd "$BUILD_DIR"

# Set COPYFILE_DISABLE to prevent macOS resource fork files (._*) from being included
export COPYFILE_DISABLE=1
tar -czf "actual-api-$VERSION.tgz" -C package .

echo ""
echo "✅ Release package created successfully!"
echo "📄 Tarball: $BUILD_DIR/actual-api-$VERSION.tgz"
echo "📊 Size: $(du -h "$BUILD_DIR/actual-api-$VERSION.tgz" | cut -f1)"
echo ""
echo "Test locally:"
echo "  npm install $BUILD_DIR/actual-api-$VERSION.tgz"
echo ""
echo "Upload to GitHub:"
echo "  gh release create v$VERSION $BUILD_DIR/actual-api-$VERSION.tgz"
