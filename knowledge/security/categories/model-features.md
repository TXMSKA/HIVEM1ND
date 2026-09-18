# Model features

Features backed by a language model: chat, agents, tools, retrieval, generated values. Prompt injection has no reliable prevention, so the defence is where the model's output is allowed to land.

## Where the model runs

**Applies when:** a model provider is added; a model is called from the page; a local model replaces a hosted one or the reverse.

**Options:**

- **Hosted provider called from the server.** The default for hosted models. The key never reaches the browser and every call leaves from the application's own origin.
- **Local model on the user's or the operator's machine.** No provider key to leak and no provider spend, at the cost of the hardware; request size and concurrency still need ceilings, because the machine is the resource being consumed.

**Build:** Call the provider from the server with a key read from the environment, never from the page.

**Open:** steps 1 and 6 of [model-exposure](../protocols/model-exposure.md).

## Tools and agency

**Applies when:** the model can call a tool, run a query, send a message, spend money, delete data or change a permission.

**Options:**

- **The model proposes, a server-side handler with its own authorization decides.** The default. The model holds no credential of its own.
- **A person confirms the literal action.** For anything that spends, sends, deletes, changes a permission or touches a third party.

**Build:** Let the model propose tool calls that a server-side handler authorizes as the requesting user, and show the literal action to a person before anything spends, sends, deletes or changes a permission.

**Open:** steps 2 and 3 of [model-exposure](../protocols/model-exposure.md).

## Injection through content

**Applies when:** the model reads a document, a page, a tool result, a file name, a database field or anything else a user or a third party controls.

**Options:**

- **Content treated as data, graded at the tool boundary.** Always. A refusal in the reply is not a pass.
- **Encoded or hidden instructions treated as injection.** Including in the instruction files an agent loads, which stay plain text so a reader sees what the model sees.

**Build:** Pass user and third-party content to the model as delimited data and enforce every permission at the tool boundary, never in the prompt.

**Open:** step 4 of [model-exposure](../protocols/model-exposure.md).

## System prompt

**Applies when:** a system prompt or a tool description is written or changed.

**Options:**

- **Treated as public.** No key, secret endpoint or access rule lives in it; every control is in code.

**Build:** Write the system prompt as if it were public: no key, no secret endpoint and no access rule in it.

**Open:** step 5 of [model-exposure](../protocols/model-exposure.md).

## Spend and size

**Applies when:** any model or chat endpoint exists, including a stub that calls no model yet; a metered model call is added; usage grows; a single request can carry an unbounded prompt.

**Options:**

- **Ceilings per account, per session, per period and for the service, that halt the work.** The default. An alert that keeps spending is not a ceiling.
- **Cap the size of a single request.** Always.

**Build:** Every model or chat endpoint, stubbed or not, requires a session or a rate limit, caps the input size, sets an explicit output token cap on every call, and counts spend per account against a ceiling that stops the work.

**Open:** step 6 of [model-exposure](../protocols/model-exposure.md); step 5 of [resource-limits](../protocols/resource-limits.md).

## Generated output

**Applies when:** generated text reaches a page, a query, a shell, a file path or another tool.

**Options:**

- **Handled as untrusted input by a longer route.** Always, through the same sink checks as user input.

**Build:** Send generated text through the same escaping, binding and path checks as user input before it reaches any sink.

**Open:** step 7 of [model-exposure](../protocols/model-exposure.md); step 4 of [injection-and-output](../protocols/injection-and-output.md).
