#!/bin/bash
# Installation script for ProkScope bioinformatics dependencies

set -e

echo "Installing bioinformatics tools for ProkScope..."

if [ "$EUID" -ne 0 ]; then
    echo "This script requires sudo privileges."
    echo "Please run with: sudo bash install_tools.sh"
    exit 1
fi

apt-get update

install_if_missing() {
    local cmd=$1
    local pkg=${2:-$1}
    if ! command -v "$cmd" &> /dev/null; then
        echo "Installing $pkg..."
        apt-get install -y "$pkg"
        echo "✓ $pkg installed"
    else
        echo "✓ $cmd already installed ($(command -v $cmd))"
    fi
}

# Core alignment tools
install_if_missing minimap2
install_if_missing samtools

# Required by medaka 2.x for VCF processing
install_if_missing bcftools
install_if_missing bgzip tabix   # bgzip ships with tabix on Debian/Ubuntu
install_if_missing tabix tabix

pip install medaka pyabpoa

rm -rf /var/lib/apt/lists/*

echo ""
echo "Verifying installations..."
for tool in minimap2 samtools bcftools bgzip tabix medaka medaka_consensus; do
    if command -v "$tool" &> /dev/null; then
        echo "✓ $tool: $(command -v $tool)"
    else
        echo "✗ $tool: NOT FOUND"
    fi
done

echo ""
echo "Done."