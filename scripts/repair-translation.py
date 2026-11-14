"""Generate a replacement for one diagnosed span using the local Marian checkpoint."""
import json
import os
import sys
from pathlib import Path

import torch
from transformers import MarianMTModel, MarianTokenizer


def main():
    request = json.load(sys.stdin)
    target = request["target"]
    if target not in ("en", "zh"):
        raise ValueError("Unsupported translation direction")
    root = Path(os.environ["SUW_REPAIR_MODEL_DIR"])
    base = str(root / "base" / target)
    torch.set_num_threads(4)
    tokenizer = MarianTokenizer.from_pretrained(base, local_files_only=True)
    model = MarianMTModel.from_pretrained(base, local_files_only=True).eval()
    checkpoint = root / ("span-revision-" + target) / "decoder-last-layer.pt"
    model.model.decoder.layers[-1].load_state_dict(
        torch.load(str(checkpoint), map_location="cpu", weights_only=True)
    )
    prompt = "Source: {source} Draft: {fragment} Error: {diagnosis}. Replace the marked fragment only.".format(
        **request
    )
    with torch.no_grad():
        output = model.generate(
            **tokenizer(prompt, return_tensors="pt", truncation=True, max_length=512),
            num_beams=request["round"], max_new_tokens=64,
        )
    replacement = tokenizer.decode(output[0], skip_special_tokens=True).strip()
    print(json.dumps({"replacement": replacement}))


if __name__ == "__main__":
    main()
