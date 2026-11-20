# Security and privacy

Do not commit API keys, signing private keys, account cookies or real user drafts. Catalogs contain public verification material and release metadata only.

Opening an assistant reads the current page into its local material field. Existing drafts and edits are preserved. Only an explicit transformation sends text to the model configured in Aer; API keys stay in the host.

Host API 4 adds `editor.fill`: an explicit button opens a newly claimed tab in the same Profile and fills a fixed platform editor. Plugins cannot choose URLs, execute scripts, read credentials, submit posts or save server-side drafts. Account login, media, platform declarations and final publication remain with the user. API 3 packages never receive the new permission.

The host checks exact tab ownership, origin, editor route, document readiness and existing field content before filling. It does not overwrite an occupied editor or retry after uncertain/partial insertion. Tokens needed by the WeChat editor stay in that platform page. Generated content is passed as plain text or escaped paragraphs, never executable HTML.

The 0.2.0 source and host adapter have passed JavaScript syntax checks and local Objective-C++ syntax checks, but have not been exercised on authenticated live platforms or through a complete linked host build. Isolated UI previews use sample data and a mock transport. Report issues without posting credentials or private drafts in public issues.
