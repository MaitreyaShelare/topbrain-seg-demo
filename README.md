# TopBrain Seg - IE 643 Course Project

Team Astra. Lightweight brain vessel segmentation via knowledge distillation.

Deployed as a static PWA. Install on Android or desktop via the browser's Add to Home Screen flow. After first load, the service worker caches the ONNX model and all 10 test cases for fully offline inference.

Source: 6.23M-parameter 3D U-Net student, distilled from a 970M-parameter nnU-Net teacher on TopBrain 2025.
