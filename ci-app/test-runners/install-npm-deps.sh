#!/usr/bin/env bash

set -e

# the sctipt install npm dependencies + dev dependencies

BUILD_DIR=$1

cd $BUILD_DIR

npm i
echo "Installing dev dependencies..."
npm i --only=dev
echo "Installing deepmerge..."
npm i --no-save deepmerge
echo "Installing @open-wc/testing-karma..."
npm i --no-save @open-wc/testing-karma
echo "Dependencies are installed."
