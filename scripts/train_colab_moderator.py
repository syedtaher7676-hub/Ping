#!/usr/bin/env python3
"""
Free Model Training & ONNX Export Script (Run in Google Colab with free T4 GPU)
-------------------------------------------------------------------------------
This script:
1. Loads the chat moderation dataset (training_dataset_ready.json or moderation_dataset.json).
2. Tokenizes text using DistilBERT tokenizer.
3. Fine-tunes DistilBERT for binary classification (0 = Safe, 1 = Toxic/Slur Violation).
4. Computes accuracy, precision, recall, and F1 score.
5. Exports the trained model to quantized ONNX format.
6. Saves all assets ready to drop directly into the Node.js backend.
"""

import os
import json
import torch
import numpy as np
from datasets import Dataset
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    Trainer,
    TrainingArguments,
    DataCollatorWithPadding
)

def compute_metrics(eval_pred):
    logits, labels = eval_pred
    predictions = np.argmax(logits, axis=-1)
    
    acc = np.mean(predictions == labels)
    tp = np.sum((predictions == 1) & (labels == 1))
    fp = np.sum((predictions == 1) & (labels == 0))
    fn = np.sum((predictions == 0) & (labels == 1))
    
    precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0
    
    return {
        "accuracy": acc,
        "precision": precision,
        "recall": recall,
        "f1": f1
    }

def main():
    print("=" * 65)
    print("🚀 Starting AI Text & Slur Moderation Training Pipeline")
    print("=" * 65)

    # 1. Check GPU availability
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"🖥️  Compute device: {device} ({torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'})")

    # 2. Load dataset
    dataset_candidates = [
        "data/training_dataset_ready.json",
        "data/moderation_dataset.json"
    ]
    
    samples = None
    for dataset_file in dataset_candidates:
        if os.path.exists(dataset_file):
            print(f"📊 Loading dataset from {dataset_file}...")
            with open(dataset_file, "r", encoding="utf-8") as f:
                samples = json.load(f)
            break

    if not samples:
        print("⚠️ No local dataset file found, using built-in seed dataset...")
        samples = [
            {"text": "hey! how are you doing?", "label": 0},
            {"text": "just working on a school project", "label": 0},
            {"text": "that was a killer workout session!", "label": 0},
            {"text": "the weather is so nice today", "label": 0},
            {"text": "kys loser nobody likes you", "label": 1},
            {"text": "kill yourself idiot", "label": 1},
            {"text": "m18 looking for girl snapchat me", "label": 1},
            {"text": "add my snap @coolguy_99", "label": 1},
            {"text": "shut up you faggot", "label": 1},
            {"text": "you dumb nigger", "label": 1},
            {"text": "f@ggot gtfo", "label": 1},
            {"text": "bhenchod saale bhag", "label": 1},
            {"text": "chutiya gandu", "label": 1},
            {"text": "stupid retard", "label": 1},
            {"text": "fucking cunt", "label": 1}
        ]

    print(f"📊 Loaded {len(samples)} training samples.")

    # Convert to Hugging Face Dataset and split train/eval
    raw_dataset = Dataset.from_list(samples)
    split_dataset = raw_dataset.train_test_split(test_size=0.2, seed=42)
    train_ds = split_dataset["train"]
    eval_ds = split_dataset["test"]

    print(f"📈 Split into {len(train_ds)} training samples and {len(eval_ds)} validation samples.")

    # 3. Model & Tokenizer
    model_name = "distilbert-base-uncased"
    print(f"📦 Loading base model: {model_name}...")
    tokenizer = AutoTokenizer.from_pretrained(model_name)

    def preprocess_function(examples):
        return tokenizer(examples["text"], truncation=True, max_length=128)

    tokenized_train = train_ds.map(preprocess_function, batched=True)
    tokenized_eval = eval_ds.map(preprocess_function, batched=True)

    model = AutoModelForSequenceClassification.from_pretrained(
        model_name,
        num_labels=2,
        id2label={0: "SAFE", 1: "VIOLATION"},
        label2id={"SAFE": 0, "VIOLATION": 1}
    )

    # 4. Training Arguments
    output_dir = "./trained_model"
    training_args = TrainingArguments(
        output_dir=output_dir,
        learning_rate=2e-5,
        per_device_train_batch_size=16,
        per_device_eval_batch_size=16,
        num_train_epochs=4,
        weight_decay=0.01,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1",
        logging_steps=10,
        report_to="none"
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized_train,
        eval_dataset=tokenized_eval,
        tokenizer=tokenizer,
        data_collator=DataCollatorWithPadding(tokenizer=tokenizer),
        compute_metrics=compute_metrics
    )

    print("⚡ Starting training (typically 1-3 minutes on Colab GPU)...")
    trainer.train()

    eval_results = trainer.evaluate()
    print("📈 Evaluation Results:", json.dumps(eval_results, indent=2))

    # Save pytorch model
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)
    print(f"✅ Trained PyTorch model saved to {output_dir}")

    # 5. Export to ONNX for Node.js serving
    print("🔄 Exporting to ONNX format...")
    onnx_output_dir = "./custom_moderator_onnx"
    try:
        from optimum.onnxruntime import ORTModelForSequenceClassification
        ort_model = ORTModelForSequenceClassification.from_pretrained(output_dir, export=True)
        ort_model.save_pretrained(onnx_output_dir)
        tokenizer.save_pretrained(onnx_output_dir)
        print(f"🎉 SUCCESS! ONNX model exported to {onnx_output_dir}")
        print("Copy the contents of custom_moderator_onnx into your Node app at `src/data/models/custom_moderator/`.")
    except Exception as e:
        print(f"Note: To export ONNX in Colab, run: !pip install optimum[exporters] onnx onnxruntime")
        print(f"Export error detail: {e}")

if __name__ == "__main__":
    main()
