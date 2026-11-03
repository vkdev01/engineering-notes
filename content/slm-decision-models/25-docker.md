---
section: "25"
title: "Docker"
kicker: "Deployment"
abstract: "A small, reproducible image: multi-stage build, non-root, health checks, and a model baked in or mounted."
time: "5 min"
order: 25
outcomes:
  - "Write a small, non-root image with a real readiness check"
  - "Size container limits from the model's peak RSS"
  - "Smoke-test the image before shipping it"
---

The deployment goal is a container that starts in seconds, serves a decision in milliseconds, and fails predictably.
That means a slim base, a baked artefact, a warm-up on start, and a health check that reflects readiness rather than
liveness.

## Dockerfile

```dockerfile
# ---- build stage ----
FROM python:3.12-slim AS build
WORKDIR /app
COPY requirements.txt code/ ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt \
 && pip install --no-cache-dir --prefix=/install ./code

# ---- runtime stage ----
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=4 TOKENIZERS_PARALLELISM=false
RUN useradd -m -u 10001 app
WORKDIR /app
COPY --from=build /install /usr/local
COPY src/ /app/src/
COPY artifacts/slm-360m-int8/ /app/artifacts/slm-360m-int8/
USER app
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=40s --retries=3 \
  CMD python -c "import urllib.request;urllib.request.urlopen('http://localhost:8000/ready')"
CMD ["uvicorn", "src.serve:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
```

## Why each choice

| Choice | Reason |
| --- | --- |
| `python:3.12-slim` | ~130 MB base; torch CPU wheels add ~800 MB, so the base is not the problem — the wheels are |
| Multi-stage | Keeps compilers out of the runtime image; typically 300–500 MB smaller |
| Non-root user | Required by most cluster policies and by any serious security review |
| Baked artefact | No network fetch at start — deterministic start time and no registry dependency at runtime |
| 1 worker | The model is in-process; multiple workers multiply memory. Scale with replicas, not workers |
| `/ready` vs `/health` | Readiness must include "model loaded and warm", not just "process alive" |

## Serving app

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from slm_decision import SLMDecisionModel, DecisionSpec

app = FastAPI(title="slm-decision")
model = None

@app.on_event("startup")
def load():
    global model, spec
    spec = DecisionSpec.load("artifacts/spec.json")
    model = SLMDecisionModel.from_pretrained("artifacts/slm-360m-int8", device="cpu")
    model.warmup(n=5)                      # pay allocator costs before traffic arrives

class Req(BaseModel):
    text: str

@app.post("/decide")
def decide(req: Req):
    if not req.text.strip():
        return {"action": spec.abstain, "confidence": 0.0, "reason_code": "EMPTY"}
    r = model.decide(req.text)
    return {"action": r.action, "confidence": r.confidence,
            "reason_code": r.reason_code, "model": model.version}

@app.get("/ready")
def ready():
    if model is None:
        raise HTTPException(503, "model not loaded")
    return {"status": "ready", "model": model.version}
```

## Resource sizing

```text
# docker-compose.yml
services:
  slm:
    build: .
    ports: ["8000:8000"]
    deploy:
      resources:
        limits:   { cpus: "2", memory: "1.5G" }
        reservations: { memory: "800M" }
    environment:
      OMP_NUM_THREADS: "2"
    read_only: true
    tmpfs: ["/tmp"]
    security_opt: ["no-new-privileges:true"]
```

A 360M INT8 model peaks around 520 MB RSS at batch 1. Budget 2.5–3× the weights for the container limit so that
concurrency spikes and the tokenizer do not trigger OOM kills.

## Image size expectations

| Contents | Approximate size |
| --- | --- |
| python:3.12-slim base | 130 MB |
| torch CPU wheel | 750–900 MB |
| transformers + tokenizers + deps | 90 MB |
| 360M INT8 artefact | 360 MB |
| Application code | < 1 MB |
| **Total** | **~1.4 GB** |

If that is too large, the biggest lever is not `slim` — it is dropping torch in favour of ONNX Runtime
(~180 MB), which is also usually 1.3–2× faster on CPU for small models. See
[edge deployment](/c/slm-decision-models/27-edge-devices).

## Smoke test before you ship the image

```bash
docker build -t slm-decision:local .
docker run --rm -p 8000:8000 slm-decision:local &
sleep 5
curl -s localhost:8000/ready
curl -s -X POST localhost:8000/decide -H 'content-type: application/json' \
  -d '{"text":"Claim denied without reason; policy 4.2 requires one."}'
docker stats --no-stream slm-decision:local
```
