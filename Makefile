PLIST_LABEL    := com.github.nonz250.claude-issue-worker
PLIST_TEMPLATE := launchd/$(PLIST_LABEL).plist.template
PLIST_FILE     := launchd/$(PLIST_LABEL).plist
PLIST_DEST     := $(HOME)/Library/LaunchAgents/$(PLIST_LABEL).plist
PROJECT_ROOT   := $(shell pwd)
NODE_PATH      := $(shell which node)
CURRENT_PATH   := $(shell echo $$PATH)

.PHONY: check-config setup install uninstall

setup:
	npm install
	npm run build
	@echo "Setup complete. Run 'make install' to register with launchd."

check-config:
	@test -f config.yml || (echo "Error: config.yml が見つかりません。" && \
		echo "  cp config.yml.example config.yml" && \
		echo "  で作成し、リポジトリ情報を編集してください。" && exit 1)

install: check-config setup $(PLIST_FILE)
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
	sed -e 's|__NODE_PATH__|$(NODE_PATH)|g' \
	    -e 's|__PROJECT_ROOT__|$(PROJECT_ROOT)|g' \
	    -e 's|__PATH__|$(CURRENT_PATH)|g' \
	    -e 's|__LOG_DIR__|$(PROJECT_ROOT)/logs|g' \
	    $(PLIST_TEMPLATE) > $(PLIST_FILE)
	@echo "Generated: $(PLIST_FILE)"
