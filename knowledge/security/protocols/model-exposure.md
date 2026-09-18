name: model-exposure
purpose: Prove an injected instruction reaches nothing privileged and that spend has a hard ceiling.
scope: model calls, agents, tools, retrieval indexes, system prompts and generated output that reaches a user or a system
trigger: task close when the closed work matches the scope, or manual
repeat: once per audit, and again whenever a tool, a data source or a model is added
inputs: the model call sites, the tool definitions, the retrieval sources, the provider console, the browser network log
stop: an API key is found in the client bundle or a request goes from the page straight to the provider, which is a P0
report: the key location per call site, the tool inventory with the privilege of each, the injection results recorded at the tool boundary, the spend ceilings with the behaviour at the ceiling, and the output handling results

## Steps

1. Keep the provider credential on the server.
   Task: search the client bundle for the key value, and read the browser network log for requests going to a provider host. A request from the page directly to a model provider is a fail whatever the key's scope, and a key that reaches the browser is a finding in every case.
   Time: 20 minutes. Repository after a build, plus a browser.
   Result: zero hits for the key value in the build output, using the value search from [secrets](secrets.md), and a network log showing every model call leaving from the application's own origin.

2. Take state change away from the model.
   Task: prompt injection has no reliable prevention, so the defence is architectural. List every tool the model can call and write what each one can change and with whose privileges. The model holds no credential of its own and calls no tool that changes state directly; it proposes, and a server-side handler with its own authorization decides.
   Time: 40 minutes. Repository.
   Result: a table of tool, what it reads, what it changes, the identity it runs as, and where its authorization check lives. Any tool running with more privilege than the requesting user is a finding, and excessive agency rose to third on the current model list for this reason.

3. Put the person in front of the high impact actions.
   Task: for every action that spends money, sends a message, deletes data, changes a permission or touches a third party, show the literal action about to be taken and wait for a person. A summary of an action is not the action.
   Time: 30 minutes. Running application.
   Result: a capture per action class showing the exact parameters presented and the run halted until confirmation, plus a test where the confirmation is refused and nothing was written, read from the store.

4. Test injection, and grade it at the boundary rather than at the reply.
   Task: place instructions in every channel the model reads that a user or a third party controls: the message, an uploaded document, a retrieved page, a tool result, a file name, a database field. Include an instruction hidden by encoding or addressed to the model and not to the reader, since that is the shape real injections take. Ask the injected instruction to call a privileged tool or reveal another user's data.
   Time: 60 minutes. Running application. Only against the application under test.
   Result: per channel, the tool call log and the credential boundary showing the injected instruction reached nothing privileged. The model refusing is not a pass and is not recorded as one, because the next phrasing will not be refused.

5. Treat the system prompt as public.
   Task: the current list broadened prompt leakage into hidden context exposure on the premise that the system prompt is discoverable and no control may rest on its confidentiality. Read the system prompt and the tool descriptions for anything that is a control rather than an instruction: a key, an endpoint that is only secret, a rule that filters what a user may see.
   Time: 25 minutes. Repository.
   Result: the system prompt quoted with each item classified as instruction or control, and every control found relocated into code, with the relocation shown at a file reference.

6. Make the spend ceiling halt the work.
   Task: start from the repository, for every model or chat endpoint including a stub that calls no model yet: read the input size cap, the output token cap passed on each call, the authentication or rate limit in front of it, and the spend counter. Then set token, request and currency ceilings per account, per session, per period and for the service, at the provider and in the application, and cap the size of a single request so one call cannot carry an unbounded prompt. Reaching one stops the work; raising an alert while the work continues is not a ceiling.
   Time: 30 minutes. Repository, then running application and the provider console.
   Result: the repository reading with file references, each missing cap a finding on its own, then the configured ceilings including the single request size, an oversized request rejected with its status code, and a run against a deliberately low ceiling showing the work halted, the status returned to the caller, and the spend recorded at the provider. **Needs a person** for what the ceilings should be.

7. Handle the output as untrusted input.
   Task: model output reaching a renderer, a shell, a query, a file path or another tool is caller-controlled data by a longer route. Apply the sinks check from [injection-and-output](injection-and-output.md) to every place generated text lands.
   Time: 30 minutes. Repository, plus running application.
   Result: zero hits for generated text reaching a raw insertion sink, a query string or a command, and a test where the model is induced to emit markup showing it rendered as text with the capture.
