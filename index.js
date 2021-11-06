const ITEMS_NOSTRUM = [152898, 184659, 201005, 201022, 855604, 201006, 201007, 201008], // EU, NA, RU, JP, TH, TW, ??, ??
      ITEMS_NOCTENIUM = [100451], // JP
      BUFFS_NOSTRUM = [
        4020, 4021, 4024, 4025, //Prime Battle Solution, (Guide)
        4030, 4031, 4040,       //Everful Nostrum
        4041, 4042, 4043,       //Multi-Nostrum
        6090, 6091, 6092],      //Blessing of Wisdom
      BUFFS_NOCTENIUM = [5010009],
      BUFFS_NOCTENIUM_STRONGER = [920, 921, 922],
      BUFF_RES_INVINCIBLE = 1134,
      BUFF_PHOENIX = 6007;

const SettingsUI = require('tera-mod-ui').Settings;

function ClientMod(mod) {
    this.nostrum = [];
    this.noctenium = [];

    mod.clientInterface.once('ready', async () => {
        this.nostrum = (await mod.queryData('/ItemData/Item@id=?/', [ITEMS_NOSTRUM], true, false, ['id', 'requiredLevel'])).map(result => result.attributes);
        this.noctenium = (await mod.queryData('/ItemData/Item@id=?/', [ITEMS_NOCTENIUM], true, false, ['id', 'requiredLevel'])).map(result => result.attributes);
    });
}

function NetworkMod(mod) {
    mod.game.initialize(['me', 'me.abnormalities', 'contract']);

    // Load item data
    const { nostrum, noctenium } = mod.clientMod;

    // Abnormality tracking
    function abnormalityDuration(id) {
        const abnormality = mod.game.me.abnormalities[id];
        return abnormality ? abnormality.remaining : 0n;
    }

    // Nostrum/noctenium usage
    let nostrum_item = null;
    let noctenium_item = null;

    mod.hook('S_PREMIUM_SLOT_DATALIST', 2, event => {
        event.sets.forEach(set => {
            set.inventory.filter(entry => entry.type === 1).forEach(entry => {
                const nostrum_match = nostrum.find(item => item.id === entry.id);
                if (nostrum_match) {
                    nostrum_item = {
                        data: nostrum_match,
                        packet: {
                            set: set.id,
                            slot: entry.slot,
                            type: entry.type,
                            id: entry.id
                        }
                    };
                } else {
                    const noctenium_match = noctenium.find(item => item.id === entry.id);
                    if (noctenium_match) {
                        noctenium_item = {
                            data: noctenium_match,
                            packet: {
                                set: set.id,
                                slot: entry.slot,
                                type: entry.type,
                                id: entry.id
                            }
                        };
                    }
                }
            });
        });
    });

    mod.hook('S_PREMIUM_SLOT_OFF', 'event', () => {
        nostrum_item = null;
        noctenium_item = null;
    });

    function useItem(item) {
        if (!item || mod.game.me.level < item.data.requiredLevel)
            return;

        mod.send('C_USE_PREMIUM_SLOT', 1, item.packet);
    }

    function useNostrum() {
        // Check if we need to use everful nostrum
        if (BUFFS_NOSTRUM.some(buff => abnormalityDuration(buff) > BigInt(60 * 1000)))
            return;

        // Check if we want to use everful nostrum
        if ((mod.settings.keep_resurrection_invincibility && abnormalityDuration(BUFF_RES_INVINCIBLE) > 0n) || abnormalityDuration(BUFF_PHOENIX) > 0n)
            return;

        // Use it!
        useItem(nostrum_item);
    }

    function useNoctenium() {
        // Check if a stronger buff is present
        if (BUFFS_NOCTENIUM_STRONGER.some(buff => abnormalityDuration(buff) > 0n))
            return;

        // Check if we need to use noctenium
        if (BUFFS_NOCTENIUM.some(buff => abnormalityDuration(buff) > BigInt(60 * 1000)))
            return;

        // Use it!
        useItem(noctenium_item);
    }

    function usePremiumItems() {
        // Check if enabled and premium items available
        if (!mod.settings.enabled || (mod.settings.dungeon_only && !mod.game.me.inDungeon) || (!mod.settings.civil_unrest && mod.game.me.inCivilUnrest))
            return;

        // Check if we can use premium items right now
        if (!mod.game.isIngame || mod.game.isInLoadingScreen || !mod.game.me.alive || mod.game.me.mounted || mod.game.me.inBattleground || mod.game.contract.active)
            return;

        useNostrum();
        useNoctenium();
    }

    // Hook that hides the 'item used' message
    let hide_message_hook = null;

    function hookHideMessage() {
        if (hide_message_hook) {
            mod.unhook(hide_message_hook);
            hide_message_hook = null;
        }

        if (mod.settings.hide_message) {
            hide_message_hook = mod.hook('S_SYSTEM_MESSAGE', 1, event => {
                const msg = mod.parseSystemMessage(event.message);
                if (msg && (msg.id === 'SMT_ITEM_USED' || msg.id === 'SMT_CANT_USE_ITEM_COOLTIME')) {
                    if (nostrum.some(item => msg.tokens.ItemName === `@item:${item.id}`) || noctenium.some(item => msg.tokens.ItemName === `@item:${item.id}`))
                        return false;
                }
            });
        }
    }

    hookHideMessage();

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
        nostrum_item = null;
        noctenium_item = null;
    });

    mod.game.me.on('resurrect', () => {
        // Reset interval to wait a bit until on-resurrection abnormalities (e.g. phoenix buffs) are applied to make sure we don't overwrite them
        start();
    });

    // User interaction & settings UI
    mod.command.add('ten', {
        $default() {
            if (ui) {
                ui.show();
            } else {
                mod.settings.enabled = !mod.settings.enabled;
                mod.command.message(mod.settings.enabled ? 'enabled' : 'disabled');
            }
        },
        on() {
            mod.settings.enabled = true;
            mod.command.message('enabled');
        },
        off() {
            mod.settings.enabled = false;
            mod.command.message('disabled');
        }
    });

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

module.exports = { ClientMod, NetworkMod };
