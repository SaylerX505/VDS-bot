import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } from 'discord.js';
import { joinVoiceChannel, getVoiceConnection } from '@discordjs/voice';
import { addReward, announceLevelUp, getGuildSettings, getLeaderboard, getRank, getRewards, removeReward, resetXp, setLevel, setXp, syncLevelRewards, updateGuildSettings, xpForLevel } from './levels.js';
import { addMapping, removeMapping, listMappings } from './reactionRoles.js';

const BAR_SIZE = 14;
const levelType = (option) => option.addChoices({ name: 'Text', value: 'text' }, { name: 'Voice', value: 'voice' });

export const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Check VDS latency.'),
  new SlashCommandBuilder().setName('rank').setDescription("Show a member's text and voice rank.").addUserOption(o => o.setName('user').setDescription('Member to inspect.').setRequired(false)),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Show the server XP leaderboard.')
    .addStringOption(o => o.setName('type').setDescription('Leaderboard type.').addChoices({ name: 'Text', value: 'text' }, { name: 'Voice', value: 'voice' }, { name: 'Combined', value: 'combined' })),
  new SlashCommandBuilder().setName('setxp').setDescription('Set a member XP value.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('user').setDescription('Member.').setRequired(true))
    .addStringOption(o => levelType(o.setName('type').setDescription('XP track.').setRequired(true)))
    .addIntegerOption(o => o.setName('xp').setDescription('XP amount.').setMinValue(0).setRequired(true)),
  new SlashCommandBuilder().setName('setlevel').setDescription('Set a member level.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('user').setDescription('Member.').setRequired(true))
    .addStringOption(o => levelType(o.setName('type').setDescription('Level track.').setRequired(true)))
    .addIntegerOption(o => o.setName('level').setDescription('Level from 0 to 100.').setMinValue(0).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName('resetxp').setDescription('Reset text, voice, or all XP.').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption(o => o.setName('user').setDescription('Member; omit to reset the whole server.').setRequired(false))
    .addStringOption(o => o.setName('type').setDescription('XP track.').addChoices({ name: 'All', value: 'all' }, { name: 'Text', value: 'text' }, { name: 'Voice', value: 'voice' })),
  new SlashCommandBuilder().setName('level').setDescription('Configure VDS leveling.')
    .addSubcommand(s => s.setName('status').setDescription('Show leveling configuration.'))
    .addSubcommand(s => s.setName('config').setDescription('Update leveling configuration.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable the leveling system.'))
      .addBooleanOption(o => o.setName('text').setDescription('Enable text XP.'))
      .addBooleanOption(o => o.setName('voice').setDescription('Enable voice XP.'))
      .addIntegerOption(o => o.setName('min_xp').setDescription('Minimum text XP.').setMinValue(0).setMaxValue(1000))
      .addIntegerOption(o => o.setName('max_xp').setDescription('Maximum text XP.').setMinValue(0).setMaxValue(1000))
      .addIntegerOption(o => o.setName('cooldown').setDescription('Text XP cooldown in seconds.').setMinValue(0).setMaxValue(86400))
      .addIntegerOption(o => o.setName('voice_xp').setDescription('Voice XP per interval.').setMinValue(0).setMaxValue(1000))
      .addIntegerOption(o => o.setName('voice_interval').setDescription('Voice XP interval in seconds.').setMinValue(30).setMaxValue(86400))
      .addChannelOption(o => o.setName('levelup_channel').setDescription('Channel for level-up announcements.').addChannelTypes(ChannelType.GuildText))
      .addStringOption(o => o.setName('levelup_message').setDescription('Message. Variables: [user] [user.username] [level] [oldLevel] [type].').setMaxLength(1000))
      .addBooleanOption(o => o.setName('dm').setDescription('DM members on text level-up.'))
      .addBooleanOption(o => o.setName('remove_lower').setDescription('Remove lower level reward roles.')))
    .addSubcommand(s => s.setName('rewards').setDescription('List level reward roles.'))
    .addSubcommand(s => s.setName('reward_add').setDescription('Add a level reward role.').addRoleOption(o => o.setName('role').setDescription('Reward role.').setRequired(true)).addIntegerOption(o => o.setName('text_level').setDescription('Required text level; 0 disables this requirement.').setMinValue(0).setMaxValue(100)).addIntegerOption(o => o.setName('voice_level').setDescription('Required voice level; 0 disables this requirement.').setMinValue(0).setMaxValue(100)))
    .addSubcommand(s => s.setName('reward_remove').setDescription('Remove a level reward role.').addIntegerOption(o => o.setName('id').setDescription('Reward ID from /level rewards.').setMinValue(1).setRequired(true)))
    .addSubcommand(s => s.setName('ignore_role').setDescription('Add or remove a no-XP role.').addStringOption(o => o.setName('action').setDescription('Action.').setRequired(true).addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' })).addRoleOption(o => o.setName('role').setDescription('Role.').setRequired(true)))
    .addSubcommand(s => s.setName('ignore_channel').setDescription('Add or remove a no-XP channel.').addStringOption(o => o.setName('action').setDescription('Action.').setRequired(true).addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' })).addChannelOption(o => o.setName('channel').setDescription('Channel.').addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice).setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder().setName('join').setDescription('Join your current voice channel.'),
  new SlashCommandBuilder().setName('leave').setDescription('Leave the current voice channel.'),
  new SlashCommandBuilder().setName('reactionrole').setDescription('Manage reaction roles.').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(s => s.setName('add').setDescription('Map a reaction on a message to a role.')
      .addChannelOption(o => o.setName('channel').setDescription('Channel containing the target message.').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('Target message ID.').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('Unicode emoji or server custom emoji.').setRequired(true).setAutocomplete(true))
      .addRoleOption(o => o.setName('role').setDescription('Role to grant/remove.').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove a reaction-role mapping.')
      .addChannelOption(o => o.setName('channel').setDescription('Channel containing the target message.').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('Target message ID.').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('Unicode emoji or server custom emoji.').setRequired(true).setAutocomplete(true)))
    .addSubcommand(s => s.setName('list').setDescription('List mappings for a message.')
      .addChannelOption(o => o.setName('channel').setDescription('Channel containing the target message.').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('Target message ID.').setRequired(true)))
].map(c => c.toJSON());

function bar(current, required) {
  const ratio = required <= 0 ? 1 : Math.min(1, Math.max(0, current / required));
  const filled = Math.round(ratio * BAR_SIZE);
  return `${'▰'.repeat(filled)}${'▱'.repeat(BAR_SIZE - filled)}`;
}

function rankEmbed(guild, user, rank) {
  const textBase = xpForLevel(rank.textLevel);
  const textNext = rank.textLevel >= 100 ? textBase : xpForLevel(rank.textLevel + 1);
  const voiceBase = xpForLevel(rank.voiceLevel);
  const voiceNext = rank.voiceLevel >= 100 ? voiceBase : xpForLevel(rank.voiceLevel + 1);
  const textProgress = Math.max(0, rank.textXp - textBase);
  const voiceProgress = Math.max(0, rank.voiceXp - voiceBase);
  const textNeed = Math.max(0, textNext - textBase);
  const voiceNeed = Math.max(0, voiceNext - voiceBase);
  return new EmbedBuilder().setColor(0x5865F2)
    .setAuthor({ name: `${user.username}'s rank`, iconURL: user.displayAvatarURL({ size: 128 }) })
    .addFields(
      { name: `Text • Level ${rank.textLevel}`, value: `${bar(textProgress, textNeed)}\n**${rank.textXp.toLocaleString()} XP** • ${rank.textLevel >= 100 ? 'MAX LEVEL' : `${(textNext - rank.textXp).toLocaleString()} XP to next`}\nServer Rank: **#${rank.textRank}**`, inline: false },
      { name: `Voice • Level ${rank.voiceLevel}`, value: `${bar(voiceProgress, voiceNeed)}\n**${rank.voiceXp.toLocaleString()} XP** • ${rank.voiceLevel >= 100 ? 'MAX LEVEL' : `${(voiceNext - rank.voiceXp).toLocaleString()} XP to next`}\nServer Rank: **#${rank.voiceRank}**`, inline: false }
    ).setFooter({ text: `VDS • ${guild.name}` });
}

function adminCheck(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

export async function autocompleteReactionRole(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const results = [];
  for (const emoji of interaction.guild.emojis.cache.values()) {
    if (!focused || emoji.name.toLowerCase().includes(focused) || emoji.id.includes(focused)) results.push({ name: `${emoji.animated ? 'Animated ' : ''}:${emoji.name}:`, value: `${emoji.animated ? '<a:' : '<:'}${emoji.name}:${emoji.id}>` });
    if (results.length >= 25) break;
  }
  await interaction.respond(results);
}

export async function handleCommand(interaction) {
  if (!interaction.guild) return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
  if (interaction.commandName === 'ping') return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('VDS • Online').setDescription(`WebSocket latency: **${interaction.client.ws.ping}ms**`)] });

  if (interaction.commandName === 'rank') {
    const user = interaction.options.getUser('user') || interaction.user;
    return interaction.reply({ embeds: [rankEmbed(interaction.guild, user, await getRank(interaction.guildId, user.id))] });
  }

  if (interaction.commandName === 'leaderboard') {
    const type = interaction.options.getString('type') || 'text';
    const rows = await getLeaderboard(interaction.guildId, type);
    const title = type === 'voice' ? 'Voice XP Leaderboard' : type === 'combined' ? 'Combined XP Leaderboard' : 'Text XP Leaderboard';
    const description = rows.length ? rows.map((r, i) => `**${String(i + 1).padStart(2, '0')}**  <@${r.user_id}>  •  Level **${r.level}**  •  ${Number(r.xp).toLocaleString()} XP`).join('\n') : 'No XP has been recorded yet.';
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`VDS • ${title}`).setDescription(description).setFooter({ text: 'Top 10 members' })] });
  }

  if (interaction.commandName === 'setxp' || interaction.commandName === 'setlevel') {
    if (!adminCheck(interaction)) return interaction.reply({ content: 'You need Manage Server to use this command.', ephemeral: true });
    const user = interaction.options.getUser('user', true);
    const type = interaction.options.getString('type', true);
    const rank = interaction.commandName === 'setxp' ? await setXp(interaction.guildId, user.id, type, interaction.options.getInteger('xp', true)) : await setLevel(interaction.guildId, user.id, type, interaction.options.getInteger('level', true));
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member) await syncLevelRewards(interaction.guild, member, rank);
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle(`VDS • ${interaction.commandName === 'setxp' ? 'XP Updated' : 'Level Updated'}`).setDescription(`<@${user.id}> • **${type}**\nLevel **${type === 'text' ? rank.textLevel : rank.voiceLevel}** • ${type === 'text' ? rank.textXp : rank.voiceXp} XP`)], ephemeral: true });
  }

  if (interaction.commandName === 'resetxp') {
    if (!adminCheck(interaction)) return interaction.reply({ content: 'You need Manage Server to use this command.', ephemeral: true });
    const user = interaction.options.getUser('user');
    const type = interaction.options.getString('type') || 'all';
    await resetXp(interaction.guildId, user?.id || null, type);
    if (user) { const member = await interaction.guild.members.fetch(user.id).catch(() => null); if (member) await syncLevelRewards(interaction.guild, member); }
    return interaction.reply({ content: user ? `Reset **${type}** XP for <@${user.id}>.` : `Reset **${type}** XP for the entire server.`, ephemeral: true });
  }

  if (interaction.commandName === 'level') {
    if (!adminCheck(interaction)) return interaction.reply({ content: 'You need Manage Server to configure leveling.', ephemeral: true });
    const sub = interaction.options.getSubcommand();
    if (sub === 'status') {
      const s = await getGuildSettings(interaction.guildId);
      const rewards = await getRewards(interaction.guildId);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('VDS • Leveling Configuration').addFields(
        { name: 'System', value: s.xp_enabled ? 'Enabled' : 'Disabled', inline: true },
        { name: 'Text XP', value: s.text_xp_enabled ? `${s.xp_min}–${s.xp_max} XP / ${Math.round(s.xp_cooldown_ms / 1000)}s` : 'Disabled', inline: true },
        { name: 'Voice XP', value: s.voice_xp_enabled ? `${s.voice_xp_amount} XP / ${Math.round(s.voice_xp_interval_ms / 1000)}s` : 'Disabled', inline: true },
        { name: 'Level cap', value: '100', inline: true },
        { name: 'No-XP roles', value: String(s.no_xp_roles?.length || 0), inline: true },
        { name: 'No-XP channels', value: String(s.no_xp_channels?.length || 0), inline: true },
        { name: 'Rewards', value: String(rewards.length), inline: true },
        { name: 'Remove lower rewards', value: s.remove_lower_rewards ? 'Yes' : 'No', inline: true },
        { name: 'Level-up channel', value: s.levelup_channel_id ? `<#${s.levelup_channel_id}>` : 'Not configured', inline: true }
      ).setFooter({ text: 'VDS • ProBot-style leveling' })] });
    }
    if (sub === 'config') {
      const s = await getGuildSettings(interaction.guildId);
      const patch = {};
      const values = [['enabled', 'xp_enabled'], ['text', 'text_xp_enabled'], ['voice', 'voice_xp_enabled'], ['dm', 'levelup_dm'], ['remove_lower', 'remove_lower_rewards']];
      for (const [input, field] of values) { const value = interaction.options.getBoolean(input); if (value !== null) patch[field] = value; }
      const min = interaction.options.getInteger('min_xp'); const max = interaction.options.getInteger('max_xp');
      if (min !== null) patch.xp_min = min; if (max !== null) patch.xp_max = max;
      if (min !== null && max === null && min > Number(s.xp_max)) return interaction.reply({ content: 'Minimum XP cannot exceed maximum XP.', ephemeral: true });
      if (max !== null && min === null && max < Number(s.xp_min)) return interaction.reply({ content: 'Maximum XP cannot be below minimum XP.', ephemeral: true });
      const cooldown = interaction.options.getInteger('cooldown'); const voiceXp = interaction.options.getInteger('voice_xp'); const voiceInterval = interaction.options.getInteger('voice_interval');
      if (cooldown !== null) patch.xp_cooldown_ms = cooldown * 1000; if (voiceXp !== null) patch.voice_xp_amount = voiceXp; if (voiceInterval !== null) patch.voice_xp_interval_ms = voiceInterval * 1000;
      const channel = interaction.options.getChannel('levelup_channel'); if (channel) patch.levelup_channel_id = channel.id;
      const message = interaction.options.getString('levelup_message'); if (message !== null) patch.levelup_message = message;
      const updated = await updateGuildSettings(interaction.guildId, patch);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('VDS • Leveling Updated').setDescription('Configuration saved.').addFields({ name: 'System', value: updated.xp_enabled ? 'Enabled' : 'Disabled', inline: true }, { name: 'Text', value: updated.text_xp_enabled ? `${updated.xp_min}–${updated.xp_max} XP` : 'Disabled', inline: true }, { name: 'Voice', value: updated.voice_xp_enabled ? `${updated.voice_xp_amount} XP / ${Math.round(updated.voice_xp_interval_ms / 1000)}s` : 'Disabled', inline: true })], ephemeral: true });
    }
    if (sub === 'rewards') {
      const rewards = await getRewards(interaction.guildId);
      const description = rewards.length ? rewards.map(r => `**#${r.reward_id}** <@&${r.role_id}> • Text ${r.text_level || '—'} • Voice ${r.voice_level || '—'}`).join('\n') : 'No level rewards configured.';
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('VDS • Level Rewards').setDescription(description)] });
    }
    if (sub === 'reward_add') {
      const role = interaction.options.getRole('role', true);
      const text = interaction.options.getInteger('text_level') || 0;
      const voice = interaction.options.getInteger('voice_level') || 0;
      const me = interaction.guild.members.me;
      if (!text && !voice) return interaction.reply({ content: 'Set at least one of text_level or voice_level above 0.', ephemeral: true });
      if (!me || role.managed || role.position >= me.roles.highest.position) return interaction.reply({ content: 'That role cannot be managed by VDS. Put the bot role above it.', ephemeral: true });
      await addReward(interaction.guildId, role.id, text, voice);
      return interaction.reply({ content: `Added <@&${role.id}> as a level reward.`, ephemeral: true });
    }
    if (sub === 'reward_remove') {
      await removeReward(interaction.guildId, interaction.options.getInteger('id', true));
      return interaction.reply({ content: 'Level reward removed.', ephemeral: true });
    }
    if (sub === 'ignore_role' || sub === 'ignore_channel') {
      const action = interaction.options.getString('action', true);
      const isRole = sub === 'ignore_role';
      const id = isRole ? interaction.options.getRole('role', true).id : interaction.options.getChannel('channel', true).id;
      const s = await getGuildSettings(interaction.guildId);
      const field = isRole ? 'no_xp_roles' : 'no_xp_channels';
      const current = [...(s[field] || [])];
      const next = action === 'add' ? [...new Set([...current, id])] : current.filter((value) => value !== id);
      await updateGuildSettings(interaction.guildId, { [field]: next });
      return interaction.reply({ content: `${isRole ? 'Role' : 'Channel'} ${action === 'add' ? 'added to' : 'removed from'} the no-XP list.`, ephemeral: true });
    }
  }

  if (interaction.commandName === 'join') {
    const channel = interaction.member.voice.channel;
    if (!channel) return interaction.reply({ content: 'Join a voice channel first.', ephemeral: true });
    getVoiceConnection(interaction.guildId)?.destroy();
    joinVoiceChannel({ channelId: channel.id, guildId: interaction.guildId, adapterCreator: interaction.guild.voiceAdapterCreator, selfDeaf: true });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('VDS • Voice').setDescription(`Connected to **${channel.name}**.`)] });
  }
  if (interaction.commandName === 'leave') {
    const connection = getVoiceConnection(interaction.guildId);
    if (!connection) return interaction.reply({ content: 'I am not in a voice channel.', ephemeral: true });
    connection.destroy();
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('VDS • Voice').setDescription('Disconnected from the voice channel.')] });
  }
  if (interaction.commandName === 'reactionrole') {
    const sub = interaction.options.getSubcommand();
    const channel = interaction.options.getChannel('channel', true);
    const messageId = interaction.options.getString('message', true);
    let message;
    try { message = await channel.messages.fetch(messageId); } catch { return interaction.reply({ content: 'I could not fetch that message. Check the channel, message ID, and bot permissions.', ephemeral: true }); }
    if (sub === 'add') {
      const emoji = interaction.options.getString('emoji', true); const role = interaction.options.getRole('role', true); const me = interaction.guild.members.me;
      if (!me || role.managed || role.position >= me.roles.highest.position) return interaction.reply({ content: 'That role cannot be managed by VDS. Put the bot role above it.', ephemeral: true });
      try { await message.react(emoji); await addMapping(interaction.guildId, messageId, emoji, role.id); } catch { return interaction.reply({ content: 'I could not add that reaction. Pick a server emoji from autocomplete or use a valid Unicode emoji.', ephemeral: true }); }
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('Reaction Role • Added').setDescription(`Reaction ${emoji} is now mapped to <@&${role.id}>.`)], ephemeral: true });
    }
    const emoji = interaction.options.getString('emoji', true);
    if (sub === 'remove') { await removeMapping(interaction.guildId, messageId, emoji); return interaction.reply({ content: `Removed ${emoji} from the reaction-role mapping.`, ephemeral: true }); }
    const mappings = await listMappings(interaction.guildId, messageId);
    if (!mappings.length) return interaction.reply({ content: 'No reaction-role mappings found for this message.', ephemeral: true });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Reaction Roles').setDescription(mappings.map(m => `${m.emoji_key}  →  <@&${m.role_id}>`).join('\n')).setFooter({ text: `${mappings.length} mapping${mappings.length === 1 ? '' : 's'}` })], ephemeral: true });
  }
}
