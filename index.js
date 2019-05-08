const ITEMS_NOSTRUM = [152898, 184659, 201005, 201022, 855604, 201006, 201007, 201008], // EU, NA, RU, JP, TH, TW, ??, ??
      ITEMS_NOCTENIUM = [100451], // JP
      BUFFS_NOSTRUM = [4030, 4031, 4032, 4033],
      BUFFS_NOCTENIUM = [5010009],
      BUFFS_NOCTENIUM_STRONGER = [920, 921, 922],
      BUFF_RES_INVINCIBLE = 1134,
      BUFF_PHOENIX = 6007;

const SettingsUI = require('tera-mod-ui').Settings;

module.exports = function TrueEverfulNostrum(mod) {
    mod.game.initialize(['me', 'contract']);

    // User interaction
    mod.command.add('ten', () => {
        if (ui) {
            ui.show();
        } else {
            mod.settings.enabled = !mod.settings.enabled;
            mod.command.message((mod.settings.enabled ? 'en' : 'dis') + 'abled');
        }
    });

    // Abnormality tracking
    let abnormalities = {};
    mod.hook('S_ABNORMALITY_BEGIN', 3, event => {
        if (mod.game.me.is(event.target))
            abnormalities[event.id] = Date.now() + event.duration;
    });

    mod.hook('S_ABNORMALITY_REFRESH', 1, event => {
        if (mod.game.me.is(event.target))
            abnormalities[event.id] = Date.now() + event.duration;
    });

    mod.hook('S_ABNORMALITY_END', 1, event => {
        if (mod.game.me.is(event.target))
            delete abnormalities[event.id];
    });

    function abnormalityDuration(id) {
        if (!abnormalities[id])
            return 0;
        return abnormalities[id] - Date.now();
    }

    // Nostrum/noctenium usage
    let inventory = null;
    let nostrum_item = null;
    let noctenium_item = null;
    let hide_message_hook = null;

    mod.hook('S_PCBANGINVENTORY_DATALIST', 1, event => {
        let modified = false;
        for (let item of event.inventory) {
            if (ITEMS_NOSTRUM.includes(item.item)) {
                inventory = 'pcbang';
                nostrum_item = { slot: item.slot };

                // Cooldowns from this packet don't seem to do anything except freeze your client briefly
                item.cooldown = 0;
                modified = true;
            } else if (ITEMS_NOCTENIUM.includes(item.item)) {
                inventory = 'pcbang';
                noctenium_item = { slot: item.slot };

                // Cooldowns from this packet don't seem to do anything except freeze your client briefly
                item.cooldown = 0;
                modified = true;
            }
        }

        if (modified)
            return true;
    });

    mod.hook('S_PREMIUM_SLOT_DATALIST', 1, event => {
        for (let item of event.inventory) {
            if (ITEMS_NOSTRUM.includes(item.item)) {
                inventory = 'premium';
                nostrum_item = {
                    set: event.set,
                    slot: item.slot,
                    type: item.type,
                    skill: item.skill,
                    item: item.item
                };
            } else if (ITEMS_NOCTENIUM.includes(item.item)) {
                inventory = 'premium';
                noctenium_item = {
                    set: event.set,
                    slot: item.slot,
                    type: item.type,
                    skill: item.skill,
                    item: item.item
                };
            }
        }
    });

    mod.hook('S_PREMIUM_SLOT_OFF', 'raw', event => {
        if (inventory === 'premium') {
            inventory = null;
            nostrum_item = null;
            noctenium_item = null;
        }
    });

    function hookHideMessage() {
        if (hide_message_hook) {
            mod.unhook(hide_message_hook);
            hide_message_hook = null;
        }

        if (mod.settings.hide_message) {
            hide_message_hook = mod.hook('S_SYSTEM_MESSAGE', 1, event => {
                let msg = mod.parseSystemMessage(event.message);
                if (msg && (msg.id === 'SMT_ITEM_USED' || msg.id === 'SMT_CANT_USE_ITEM_COOLTIME')) {
                    for (let item of ITEMS_NOSTRUM) {
                        if (msg.tokens['ItemName'] === '@item:' + item)
                            return false;
                    }
                    for (let item of ITEMS_NOCTENIUM) {
                        if (msg.tokens['ItemName'] === '@item:' + item)
                            return false;
                    }
                }
            });
        }
    }

    hookHideMessage();

    function useItem(item) {
        switch (inventory) {
            case 'pcbang': mod.send('C_PCBANGINVENTORY_USE_SLOT', 1, item); break;
            case 'premium': mod.send('C_PREMIUM_SLOT_USE_SLOT', 1, item); break;
        }
    }

    function useNostrum() {
        // Check if we have an everful nostrum
        if (!nostrum_item)
            return;

        // Check if we need to use everful nostrum
        for (let buff of BUFFS_NOSTRUM) {
            if (abnormalityDuration(buff) > 60 * 1000)
                return;
        }

        // Check if we want to use everful nostrum
        if ((mod.settings.keep_resurrection_invincibility && abnormalityDuration(BUFF_RES_INVINCIBLE) > 0) || abnormalityDuration(BUFF_PHOENIX) > 0)
            return;

        // Use it!
        useItem(nostrum_item);
    }

    function useNoctenium() {
        // Check if we have a premium noctenium
        if (!noctenium_item)
            return;

        // Check if we have enough level
        if (mod.game.me.level < 30)
            return;

        // Check if a stronger buff is present
        for (let buff of BUFFS_NOCTENIUM_STRONGER) {
            if (abnormalityDuration(buff) > 0)
                return;
        }

        // Check if we need to use noctenium
        for (let buff of BUFFS_NOCTENIUM) {
            if (abnormalityDuration(buff) > 60 * 1000)
                return;
        }

        // Use it!
        useItem(noctenium_item);
    }

    function usePremiumItems() {
        // Check if enabled and premium items available
        if (!mod.settings.enabled || !inventory)
            return;

        // Check if we can use premium items right now
        if (!mod.game.isIngame || mod.game.isInLoadingScreen || !mod.game.me.alive || mod.game.me.mounted || mod.game.me.inBattleground)
            return;

        useNostrum();
        useNoctenium();
    }

    // Main
    let interval = null;
    function start() {
        stop();
        interval = mod.setInterval(usePremiumItems, mod.settings.interval);
    }

    function stop() {
        if (interval) {
            mod.clearInterval(interval);
            interval = null;
        }
    }

    function isRunning() {
        return !!interval;
    }

    mod.game.on('enter_game', () => {
        start();
    });

    mod.game.on('leave_game', () => {
        stop();
        inventory = null;
        nostrum_item = null;
        noctenium_item = null;
        abnormalities = {};
    });

    mod.game.me.on('resurrect', () => {
        // Reset interval to wait a bit until on-resurrection abnormalities (e.g. phoenix buffs) are applied to make sure we don't overwrite them
        abnormalities = {};
        start();
    });

    // Settings UI
    let ui = null;
    if (global.TeraProxy.GUIMode) {
        ui = new SettingsUI(mod, require('./settings_structure'), mod.settings, { height: 232 });
        ui.on('update', settings => {
            mod.settings = settings;
            hookHideMessage();

            if (isRunning()) {
                stop();
                start();
            }
        });

        this.destructor = () => {
            if (ui) {
                ui.close();
                ui = null;
            }
        };
    }
};
