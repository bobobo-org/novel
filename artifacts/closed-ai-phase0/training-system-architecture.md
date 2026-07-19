# Training system architecture

Status: `contract_only`

The foundation separates five capability layers: base model, retrieval augmented, memory augmented, workflow augmented, and fine-tuned capability. RAG, prompts, memory, and workflow changes never imply changed model weights.

The contract flow is preference observation -> validation -> quality and contamination checks -> human review -> immutable dataset version -> contract-only training run -> closed-book evaluation -> promotion gate -> staged deployment -> observed promotion or rollback. Phase 0 stops before dataset creation, model execution, or deployment.

