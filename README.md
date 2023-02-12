# Electron HackRF Sweep WebUSB

This is electron wrap for https://github.com/cho45/hackrf-sweep-webusb

`hackrf-sweep-webusb` is a spectrum analyzer implementation in JavaScript with WebUSB for <a href="https://greatscottgadgets.com/hackrf/">HackRF</a>.


# Usage

1. Download builded binaries from release page.
2. Connect your HackRF to USB port.
3. Click [CONNECT] and select the device.
4. Set range for analysis.
5. Click [START].
6. Adjast gains.

# Implementation

1. Communication with HackRF device with <strong>WebUSB</strong>.
2. Run FFT with <strong>WebAssembly</strong> which is written in Rust (using <a href="https://github.com/awelkie/RustFFT">RustFFT</a>)
3. Show results with <strong>WebGL</strong> waterfall implementation.
