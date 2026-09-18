# Standards

Three published works answer three different questions, and confusing them is why audits produce lists nobody can act on. The testing guide says what to test. The verification standard says what passing means. The top ten says how much it matters. A finding that cites only the top ten has a severity and no test; a finding that cites only the guide has a test and no threshold.

Every edition below was read at the source on 2026-09-17. An edition is replaced without warning, so the version is checked at the start of a pass rather than trusted from this file.

## Which list is current

**Application risks.** The current list is the OWASP Top 10:2025, which replaced the 2021 edition. There is no 2026 edition. The order is A01 Broken Access Control, A02 Security Misconfiguration, A03 Software Supply Chain Failures, A04 Cryptographic Failures, A05 Injection, A06 Insecure Design, A07 Authentication Failures, A08 Software or Data Integrity Failures, A09 Security Logging and Alerting Failures, A10 Mishandling of Exceptional Conditions. Source: https://top10.owasp.org/2025

Two changes matter to how a pass is planned. Supply chain failures entered the list in third place, which is why [supply-chain](protocols/supply-chain.md) is a protocol of its own rather than a step inside a dependency check. Server-side request forgery no longer has its own row: A01 lists CWE-918 among its notable weaknesses, alongside CWE-352 for cross-site request forgery, which is why both are graded as access control failures, in [cross-site-requests](protocols/cross-site-requests.md) and [outbound-requests](protocols/outbound-requests.md).

**API risks.** The current edition is still the API Security Top 10 2023. The order is API1 Broken Object Level Authorization, API2 Broken Authentication, API3 Broken Object Property Level Authorization, API4 Unrestricted Resource Consumption, API5 Broken Function Level Authorization, API6 Unrestricted Access to Sensitive Business Flows, API7 Server Side Request Forgery, API8 Security Misconfiguration, API9 Improper Inventory Management, API10 Unsafe Consumption of APIs. Source: https://api-security.owasp.org/editions/2023/en/0x11-t10/

Object level authorization is the first item because it is the failure that scales: one endpoint, every record. The standard's own pass criterion is a test suite that covers each role against each endpoint and fails the build, not a reading of the code.

**Model risks.** The current list is the 2026 edition, published 2026-08-04. The order is LLM01 Prompt Injection, LLM02 Sensitive Information Disclosure, LLM03 Excessive Agency, LLM04 Supply Chain, LLM05 Data and Model Poisoning, LLM06 Unbounded Consumption, LLM07 Misinformation, LLM08 Hidden Context Exposure, LLM09 Vector and Embedding Weaknesses, LLM10 Improper Output Handling. Source: https://github.com/GenAI-Security-Project/GenAI-LLM-Top10

The older project site still serves an archived 2023 list under the original project name, and that page says so itself. Reading it as current produces a pass built around insecure plugin design and model theft, neither of which is on the 2026 list. Use the project repository above.

## What passing means

The Application Security Verification Standard 5.0.0 was released in May 2025. It carries seventeen numbered chapters, V1 Encoding and Sanitization through V17 WebRTC, across encoding, validation, web frontend, API, file handling, authentication, session management, authorization, self-contained tokens, OAuth and OIDC, cryptography, secure communication, configuration, data protection, secure coding and architecture, and security logging and error handling.

Its three levels are cumulative. The standard describes Level 1 as "the minimum requirements to consider when securing an application", roughly the first fifth of the requirements, covering the basic first layer of defence. It says of Level 2 that "most applications should be striving to achieve this level", roughly half the requirements, covering less common attacks and more complicated protections against common ones. Level 3 "should be the goal for applications looking to demonstrate the highest levels of security", the remaining requirements, mostly defence in depth.

The standard declines to assign levels to application types and asks for a risk decision instead, giving an early-stage product collecting little sensitive data as a Level 1 example and online banking as a Level 3 one. The working default this module uses: Level 2 for anything with a login, a payment or personal data, Level 1 for a site that only publishes. Choosing a different target is legitimate and is recorded as a decision with a name against it.

The machine readable checklist is published with the release:
https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv

## What to test

The Web Security Testing Guide supplies the category backbone and the identifiers to cite. Its checklist covers information gathering, configuration and deployment management, identity management, authentication, authorization, session management, injection, error handling, weak cryptography, business logic, client-side testing and API testing, each with a prefix such as WSTG-ATHZ or WSTG-SESS.
Source: https://github.com/OWASP/wstg/blob/master/checklists/checklist.md

The categories and protocols in this module are organised by the part of the application a change touches and by what the diff looks like, not by that taxonomy, because an agent matching work against a scope needs the shape of the change and not the name of the discipline. The identifiers are for the report, so a reader outside the session can find the underlying test.

## Runtime support

A runtime past its own end of life fails an audit regardless of any advisory, because no advisory will ever be issued for it again. The calendar is published by the runtime, not by a security project. For the JavaScript runtime it is https://nodejs.org/en/about/previous-releases, and at the last check that page listed majors 26, 24 and 22 as supported and 25, 23, 20 and 18 as ended. The page is the authority and this sentence is not.
