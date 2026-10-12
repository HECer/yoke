# Knowledge

- Claude `error_during_execution` may report zero usage after positive assistant/result observations. A crash result is not evidence that earlier measured consumption disappeared.
- Node pipe `setEncoding('utf8')` preserves split multibyte characters; decoding each Buffer independently does not.
- Vitest filesystem race fixtures must mock the named `node:fs` import and assert interception; spying on the default filesystem object alone does not prove the race was exercised.
- The stream-efficiency benchmark measures isolated functions. Production prompts retain complete unclassified binding context, so standalone retrieval savings cannot be presented as production prompt savings.
