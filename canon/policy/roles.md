# Role ownership

The host controls dispatch, acceptance, and integration. A worker implements within its assigned scope and reports evidence; it does not launch nested orchestration or self-approve the host's acceptance gate.

Self-checking is useful. Independent review requires a separate reviewer with the actual requirements, candidate, and evidence; a fresh model call alone does not establish independence. Use one combined acceptance/correctness review at a meaningful boundary. Add a security or other specialist review for a concrete risk or explicit policy, not for every small task.

The authorized integrator may commit or merge after required gates. Do not describe the implementer's own assessment as independent review. Missing independent evidence stays visible when a required reviewer is unavailable.
