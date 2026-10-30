"""Local OCR server: RapidOCR (PaddleOCR PP-OCR models on ONNX Runtime), free and offline.

POST /ocr  {"image": "data:image/...;base64,..."}
  -> {"width", "height", "ms", "lines": [{"text", "box": [x, y, w, h] as fractions, "score"}]}

Run:  uv run --with rapidocr --with onnxruntime --with pillow ocr-server/server.py   (port 8765)
"""
import base64, io, json, os, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from PIL import Image
from rapidocr import RapidOCR

engine = RapidOCR()
PORT = int(os.environ.get("OCR_PORT", "8765"))


def read(image: Image.Image) -> dict:
    image = image.convert("RGB")
    W, H = image.size
    t = time.time()
    r = engine(image)
    lines = []
    for box, text, score in zip(r.boxes if r.boxes is not None else [], r.txts or [], r.scores or []):
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        lines.append({"text": str(text), "box": [min(xs) / W, min(ys) / H, (max(xs) - min(xs)) / W, (max(ys) - min(ys)) / H], "score": round(float(score), 3)})
    lines.sort(key=lambda l: (round(l["box"][1] * 200), l["box"][0]))  # reading order: top to bottom, then left to right
    return {"width": W, "height": H, "ms": int((time.time() - t) * 1000), "lines": lines}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send(200, {"ok": True, "engine": "rapidocr"})

    def do_POST(self):
        if self.path != "/ocr":
            return self.send(404, {"error": "not found"})
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            data = body["image"].split(",", 1)[-1]
            self.send(200, read(Image.open(io.BytesIO(base64.b64decode(data)))))
        except Exception as e:  # report bad input instead of dropping the connection
            self.send(400, {"error": str(e)})

    def send(self, code, obj):
        out = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    print(f"OCR server on http://127.0.0.1:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
