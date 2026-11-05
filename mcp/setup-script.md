SETUP SCRIPT. Run it when the user asks to install, set up or add the DevOps team to a project. Call the tools yourself; ask the user only where a step says ask.

1. Call detect_project. Tell the user the languages and services found and what is already installed (cursor, claude, profile, gitignoreOk).
2. Languages and services: use what the user named. Otherwise use the detected ones and ask once whether to add or drop any, and whether they want Docker, a cloud, an AI service (Claude, GPT, Gemini, Ollama) or a VM set up. Any language works for any purpose. A language that is not listed: call get_language on a similar one, draft an entry, call add_language with apply=false and show it.
3. Call install_devops_team with apply=false (target defaults to auto: the host folders that exist, else both). If the project already has an equivalent rule file, pass skipRules. Show the user what would be created, replaced and skipped, and any warnings.
4. Ask for agreement. On yes call install_devops_team with apply=true. If status then shows gitignoreOk=false call ensure_gitignore with apply=true. Thought files go in devops-skill/thoughts/non-final/ and devops-skill/thoughts/final/; both are git-ignored.
5. Call check_toolchain for the chosen language and service ids. List what is missing with the install lines from get_language / get_service. Never install software or run the project's own commands yourself; use sandbox_plan to show how a command would run in the sandbox.
6. On request only: ghas_plan (GitHub security files), tag_history / tag_plan (releases), module_map / reuse_search (research), story_new / story_graph (stories), cleanup_scan (cleanup).
7. Finish: tell the user to fill in the "Fill in by hand" section of .devops/project.md and to commit .devops/, .cursor/ and .claude/ (not devops-skill/thoughts/).

Rules: plan before writing; write only after the user agrees; existing files are kept unless the user says replace; environment variables are named, never valued; nothing is pushed.
