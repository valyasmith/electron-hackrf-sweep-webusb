/*
Copyright (c) 2019, cho45 <cho45@lowreal.net>

All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
    Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
    Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the 
    documentation and/or other materials provided with the distribution.
    Neither the name of Great Scott Gadgets nor the names of its contributors may be used to endorse or promote products derived from this software
    without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, 
THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
import * as Comlink from "../node_modules/comlink/dist/esm/comlink.mjs";

//const Backend = Comlink.wrap(new Worker("./worker.js", { type: "module" }));
const Backend = Comlink.wrap(new Worker("./worker.js"));

Vue.use(VueMaterial.default);

class AppLoading extends Vue {
}

const CUMULATIVE_STACK_SIZE = 5;
const MAX_STACK_SIZE = 20;
const SAMPLE_RATE = 20e6;
const MAX_ALERT_SENSITIVITY_SAMPLES = 200;

new Vue({
    el: "#app",
    components: {
        AppLoading
    },
    data: {
        connected: false,
        running: false,
        snackbar: {
            show: false,
            message: ""
        },
        alert: {
            show: false,
            title: "",
            content: ""
        },
        range: {
            start: 2400,
            stop: 2500,
            fftSize: 256
        },
        canvasFftYScale: [],
        options: {
            hideSideBar: false,
            selectedDeviceNumber: '',
            ampEnabled: false,
            antennaEnabled: false,
            lnaGain: 16,
            vgaGain: 16,
            threshold: -60,
            alertSensitivity: 50,
            useThreshold: false,
            useRawChart: true,
            useMaxChart: true,
            useCumulativeChart: false,
            useAlerts: false
        },
        info: {
            serialNumber: "",
            boardId: "",
            boardName: "",
            partIdNumber: "",
            firmwareVersion: "",
        },
        metrics: {
            sweepPerSec: 0,
            bytesPerSec: 0,
        },
        devicesList: [],
        currentHover: "",
        showInfo: false,
        alertTimer: null,
        showAlert: false,
    },

    methods: {
        connect: async function () {
            this.alert.show = false;
            this.snackbar.show = true;
            this.snackbar.message = "connecting";

            let opts = null;
            if (this.options && this.options.selectedDeviceNumber) {
                const selectedDeviceNumber = this.options.selectedDeviceNumber;
                const found = this.devicesList.find(d => d.serialNumber === selectedDeviceNumber);
                console.log('found', found);
                if (found) {
                    opts = {
                        serialNumber: this.options.selectedDeviceNumber
                    };
                } else {
                    this.options.selectedDeviceNumber = '';
                    this.saveSetting();
                }
            }
            console.log('opts', opts);
            if (!await this.backend.open(opts)) {
                const device = await HackRF.requestDevice();
                if (!device) {
                    this.snackbar.message = "device is not found";
                    return;
                }
                this.snackbarMessage = "opening device";
                const ok = await this.backend.open({
                    vendorId: device.vendorId,
                    productId: device.productId,
                    serialNumber: device.serialNumber
                });
                if (!ok) {
                    this.alert.content = "failed to open device";
                    this.alert.show = true;
                }
            }

            this.connected = true;
            const {boardId, versionString, apiVersion, partId, serialNo} = await this.backend.info();

            this.info.serialNumber = serialNo.map((i) => (i + 0x100000000).toString(16).slice(1)).join('');
            this.info.boardId = boardId;
            this.info.boardName = HackRF.BOARD_ID_NAME[boardId];
            this.info.firmwareVersion = `${versionString} (API:${apiVersion[0]}.${apiVersion[1]}${apiVersion[2]})`;
            this.info.partIdNumber = partId.map((i) => (i + 0x100000000).toString(16).slice(1)).join(' ');
            this.snackbar.message = `connected to ${HackRF.BOARD_ID_NAME[this.info.boardId]}`;
            console.log('apply options', this.options);
            await this.backend.setAmpEnable(this.options.ampEnabled);
            await this.backend.setAntennaEnable(this.options.antennaEnabled);
            await this.backend.setLnaGain(+this.options.lnaGain);
            await this.backend.setVgaGain(+this.options.vgaGain);
        },

        disconnect: async function () {
            await this.stop();
            await this.backend.close();
            console.log('disconnected');
            this.connected = false;
            this.running = false;
        },

        quadraticMeanVector: function (arrays, size) {
            const result = Array.from({length: size});
            return result.map((_, i) => {
                return -1 * Math.sqrt(arrays
                    .map(xs => xs[i] || 0)
                    .reduce((sum, x) => {
                        return (sum + Math.pow(x, 2));
                    }, 0) / arrays.length);
            });
        },

        maxVector: function (arrays, size) {
            const result = Array.from({length: size});
            return result.map((_, i) => {
                return Math.max(...arrays.map(xs => xs[i] || 0));
            });
        },

        start: async function () {
            if (this.running) return;
            this.running = false;
            this.alert.show = false;

            const {canvasFft, canvasWf} = this;

            const lowFreq = +this.range.start;
            const highFreq0 = +this.range.stop;
            const bandwidth0 = highFreq0 - lowFreq;
            const steps = Math.ceil((bandwidth0 * 1e6) / SAMPLE_RATE);
            const bandwidth = (steps * SAMPLE_RATE) / 1e6;
            const highFreq = lowFreq + bandwidth;
            this.range.stop = highFreq;

            // const FFT_SIZE = +this.range.fftSize;
            // const freqBinCount = (bandwidth*1e6) / SAMPLE_RATE * FFT_SIZE;
            //
            const freqBinCount0 = canvasFft.offsetWidth * window.devicePixelRatio;
            const fftSize0 = Math.pow(2, Math.ceil(Math.log2((freqBinCount0 * SAMPLE_RATE) / (bandwidth * 1e6))));
            const fftSize1 = fftSize0 < +this.range.fftSize ? fftSize0 : +this.range.fftSize;
            const FFT_SIZE = fftSize1 > 8 ? fftSize1 : 8;
            const freqBinCount = (bandwidth * 1e6) / SAMPLE_RATE * FFT_SIZE;

            if (this.range.fftSize != FFT_SIZE) {
                this.snackbar.show = true;
                this.snackbar.message = "FFT Size is limited to rendering width";
                this.range.fftSize = FFT_SIZE;
            }


            console.log({lowFreq, highFreq, bandwidth, freqBinCount});
            const nx = Math.pow(2, Math.ceil(Math.log2(freqBinCount)));
            const maxTextureSize = 16384;
            const waterfall = (nx <= maxTextureSize) ?
                new WaterfallGL(canvasWf, freqBinCount, 256) :
                new Waterfall(canvasWf, freqBinCount, 256);

            canvasFft.height = 200;
            canvasFft.width = freqBinCount;

            const ctxFft = canvasFft.getContext('2d');

            setTimeout(this.checkMetrics.bind(this), 10000);

            const maxStack = [];
            const cumulativeStack = [];
            this.canvasFftYScale = [];
            for (let y = 1; y <= 10; y++) {
                this.canvasFftYScale.push({
                    offset: `${y * 10}%`,
                    title: `${-1 * (y * 10)}dB`
                });
            }

            await this.backend.start({
                FFT_SIZE,
                SAMPLE_RATE,
                lowFreq,
                highFreq,
                bandwidth,
                freqBinCount
            }, Comlink.proxy((rawData, metrics) => {
                this.metrics = metrics;
                requestAnimationFrame(() => {
                    const data = this.options.useThreshold ? rawData.map((i) => {
                        return i > this.options.threshold ? i : -120;
                    }) : rawData;
                    // const data = rawData
                    // console.log('data', data);

                    waterfall.renderLine(data);

                    ctxFft.fillStyle = "rgba(40, 40, 40)";
                    ctxFft.fillRect(0, 0, canvasFft.width, canvasFft.height);
                    ctxFft.save();

                    if (this.options.useMaxChart) {
                        maxStack.push(rawData);

                        const maxVector = this.maxVector(maxStack, freqBinCount);
                        ctxFft.beginPath();
                        ctxFft.moveTo(0, canvasFft.height);
                        for (let i = 0; i < freqBinCount; i++) {
                            const n = (maxVector[i] + 45) / 42;
                            ctxFft.lineTo(i, canvasFft.height - canvasFft.height * n);
                        }
                        ctxFft.strokeStyle = "#ffc003";
                        ctxFft.stroke();
                        ctxFft.restore();

                        if (maxStack.length >= MAX_STACK_SIZE) {
                            maxStack.shift();
                        }
                    }

                    if (this.options.useRawChart) {
                        ctxFft.beginPath();
                        ctxFft.moveTo(0, canvasFft.height);
                        for (let i = 0; i < freqBinCount; i++) {
                            const n = (data[i] + 45) / 42;
                            ctxFft.lineTo(i, canvasFft.height - canvasFft.height * n);
                        }
                        ctxFft.strokeStyle = "#e1e1e1";
                        ctxFft.stroke();
                        ctxFft.restore();
                    }

                    const thresholdPercent = -1 * (Number(this.options.threshold));
                    const canvasThreshold = Math.ceil(canvasFft.height * thresholdPercent / 100);

                    let quadraticMeanVector = [];
                    if (this.options.useCumulativeChart || this.options.useAlerts) {
                        const alertSensitivity = Math.ceil((100 - this.options.alertSensitivity) * MAX_ALERT_SENSITIVITY_SAMPLES / 100);
                        cumulativeStack.push(rawData);
                        quadraticMeanVector = this.quadraticMeanVector(cumulativeStack, freqBinCount);
                        if (cumulativeStack.length >= CUMULATIVE_STACK_SIZE) {
                            cumulativeStack.shift();
                        }
                        let hasOverflowValues = false;
                        let tmp = [];
                        if (this.options.useCumulativeChart) {
                            ctxFft.beginPath();
                        }
                        for (let i = 0; i < freqBinCount; i++) {
                            const n = (quadraticMeanVector[i] + 45) / 42;
                            const val = canvasFft.height - canvasFft.height * n;
                            if (this.options.useCumulativeChart) {
                                ctxFft.moveTo(i, canvasFft.height);
                                ctxFft.lineTo(i, val);
                            }
                            if (this.options.useAlerts && !hasOverflowValues) {
                                if (val < canvasThreshold) {
                                    tmp.push(quadraticMeanVector[i]);
                                } else {
                                    tmp = [];
                                }
                                if (tmp.length > alertSensitivity) {
                                    hasOverflowValues = true;
                                }
                            }
                        }
                        if (this.options.useCumulativeChart) {
                            ctxFft.strokeStyle = "#00ff00";
                            ctxFft.stroke();
                            ctxFft.restore();
                        }
                        if (this.options.useAlerts && hasOverflowValues) {
                            // console.log('alertSensitivity', alertSensitivity, 'tmp', tmp[0], tmp.length);
                            this.runAlert();
                        }
                    }

                    if (this.options.useThreshold) {
                        // ctxFft.beginPath();
                        // for (let i = 0; i < freqBinCount; i++) {
                        //     if(data[i] > -120) {
                        //         const n = (data[i] + 45) / 42;
                        //         ctxFft.moveTo(i, canvasFft.height);
                        //         ctxFft.lineTo(i, canvasFft.height - canvasFft.height * n);
                        //     }
                        // }
                        // ctxFft.strokeStyle = "#ff0000";
                        // ctxFft.stroke();
                        // ctxFft.restore();

                        ctxFft.beginPath();
                        ctxFft.moveTo(0, canvasThreshold);
                        ctxFft.lineTo(canvasFft.width, canvasThreshold);
                        ctxFft.strokeStyle = "#f33f33";
                        ctxFft.stroke();
                        ctxFft.restore();

                        ctxFft.fillStyle = "rgba(40, 40, 40, 0.85)";
                        ctxFft.fillRect(0, canvasThreshold, canvasFft.width, canvasFft.height);
                        ctxFft.save();
                    }
                });
            }));

            this.running = true;
        },

        runAlert: function () {
            this.showAlert = true;
            if (this.$refs.alertSound && this.$refs.alertSound.play) {
                this.$refs.alertSound.play();
            }
            this.alertTimer = setTimeout(()=>{
                this.showAlert = false;
            }, 2000);
        },

        checkMetrics: async function () {
            if (!this.running) {
                return;
            }
            console.log('this.checkMetrics', this.metrics.bytesPerSec, this.metrics.sweepPerSec);
            if (!this.metrics || !this.metrics.bytesPerSec || !this.metrics.sweepPerSec) {
                this.alert.content = "failed to read stream from device";
                this.alert.show = true;
                await this.stop();
            }
        },

        stop: async function () {
            this.backend.stopRx();
            this.running = false;
        },

        labelFor: function (n) {
            const lowFreq = +this.range.start;
            const highFreq = +this.range.stop;
            const bandwidth = highFreq - lowFreq;
            const freq = bandwidth * n + lowFreq;
            return (freq).toFixed(1);
        },

        saveSetting: function () {
            const json = JSON.stringify({
                range: this.range,
                options: this.options
            });
            // console.log('saveSetting', json);
            localStorage.setItem('hackrf-sweep-setting', json);
        },

        loadSetting: function () {
            try {
                const json = localStorage.getItem('hackrf-sweep-setting');
                // console.log('loadSetting', json);
                const setting = JSON.parse(json);
                this.range = setting.range;
                this.options = setting.options;
            } catch (e) {
                console.log(e);
            }
        },

        toggleSidebar: function () {
            this.options.hideSideBar = !this.options.hideSideBar;
            this.saveSetting();
        }
    },

    created: async function () {
        this.loadSetting();

        this.backend = await new Backend();
        await this.backend.init();
        this.devicesList = await this.backend.getDevicesList();

        this.$watch('options.ampEnabled', async (val) => {
            if (!this.connected) return;
            await this.backend.setAmpEnable(val);
        });

        this.$watch('options.antennaEnabled', async (val) => {
            if (!this.connected) return;
            await this.backend.setAntennaEnable(val);
        });

        this.$watch('options.lnaGain', async (val) => {
            if (!this.connected) return;
            await this.backend.setLnaGain(+val);
        });

        this.$watch('options.vgaGain', async (val) => {
            if (!this.connected) return;
            await this.backend.setVgaGain(+val);
        });
        this.$watch('options.selectedDeviceNumber', async (val) => {
            console.log('selectedDeviceNumber', val);
            await this.disconnect();
            await this.connect();
        });

        this.$watch('range', () => {
            this.saveSetting();
        }, {deep: true});

        this.$watch('options', () => {
            this.saveSetting();
        }, {deep: true});

        this.canvasWf = this.$refs.waterfall;
        this.canvasFft = this.$refs.fft;

        const hoverListenr = (e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.x;
            const p = x / rect.width;
            this.currentHover = this.labelFor(p);
            this.$refs.currentHover.style.left = (p * 100) + "%";
        };

        const leaveListener = (e) => {
            this.$refs.currentHover.style.left = "-100%";
        };

        this.$refs.waterfall.addEventListener('mousemove', hoverListenr);
        this.$refs.waterfall.addEventListener('mouseleave', leaveListener);
        this.$refs.fft.addEventListener('mousemove', hoverListenr);
        this.$refs.fft.addEventListener('mouseleave', leaveListener);

        this.connect();

        window.addEventListener('beforeunload', this.disconnect.bind(this));
    },

    mounted: function () {
    }
});

