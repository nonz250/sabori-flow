PLIST_LABEL    := com.github.nonz250.claude-issue-worker
PLIST_TEMPLATE := launchd/$(PLIST_LABEL).plist.template
PLIST_FILE     := launchd/$(PLIST_LABEL).plist
PLIST_DEST     := $(HOME)/Library/LaunchAgents/$(PLIST_LABEL).plist
PROJECT_ROOT   := $(shell pwd)
PYTHON_PATH    := $(PROJECT_ROOT)/.venv/bin/python
CURRENT_PATH   := $(shell echo $$PATH)

.PHONY: setup install uninstall

setup:
	python3 -m venv .venv
	.venv/bin/pip install -r requirements.txt
	@echo "Setup complete. Run 'make install' to register with launchd."

install: setup $(PLIST_FILE)
	mkdir -p $(HOME)/Library/LaunchAgents
	cp $(PLIST_FILE) $(PLIST_DEST)
	launchctl load $(PLIST_DEST)
	@echo "Installed and loaded: $(PLIST_DEST)"

uninstall:
	-launchctl unload $(PLIST_DEST)
	rm -f $(PLIST_DEST)
	rm -f $(PLIST_FILE)
	@echo "Unloaded and removed: $(PLIST_DEST)"

$(PLIST_FILE): $(PLIST_TEMPLATE)
	mkdir -p logs
	sed -e 's|__PYTHON_PATH__|$(PYTHON_PATH)|g' \
	    -e 's|__PROJECT_ROOT__|$(PROJECT_ROOT)|g' \
	    -e 's|__PATH__|$(CURRENT_PATH)|g' \
	    $(PLIST_TEMPLATE) > $(PLIST_FILE)
	@echo "Generated: $(PLIST_FILE)"
