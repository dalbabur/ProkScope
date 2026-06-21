#!/bin/bash
# Installation script for ProkScope bioinformatics dependencies

set -e

echo "Installing bioinformatics tools for ProkScope..."

# Check if running with sudo privileges
if [ "$EUID" -ne 0 ]; then
    echo "This script requires sudo privileges to install system packages."
    echo "Please run with: sudo bash install_tools.sh"
    exit 1
fi

# Update package list
echo "Updating package list..."
apt-get update

# Install minimap2
echo "Installing minimap2..."
if ! command -v minimap2 &> /dev/null; then
    apt-get install -y minimap2
    echo "✓ minimap2 installed"
else
    echo "✓ minimap2 already installed"
fi

# Install samtools
echo "Installing samtools..."
if ! command -v samtools &> /dev/null; then
    apt-get install -y samtools
    echo "✓ samtools installed"
else
    echo "✓ samtools already installed"
fi

# Install medaka (Python package)
echo "Installing medaka..."
if ! command -v medaka &> /dev/null; then
    pip install medaka
    echo "✓ medaka installed"
else
    echo "✓ medaka already installed"
fi

# Clean up
rm -rf /var/lib/apt/lists/*

# Verify installations
echo ""
echo "Verifying installations..."
minimap2 --version && echo "✓ minimap2 working"
samtools --version && echo "✓ samtools working"
medaka --version && echo "✓ medaka working"
medaka_consensus --version && echo "✓ medaka_consensus working"
medaka_haploid_variant --version && echo "✓ medaka_haploid_variant working"

echo ""
echo "All bioinformatics tools installed successfully!"
