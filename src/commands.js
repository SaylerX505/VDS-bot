import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } from 'discord.js';
import { joinVoiceChannel, getVoiceConnection } from '@discordjs/voice';
import { getLeaderboard, getRank, xpForLevel } from './levels.js';
import { addMapping, removeMapping, listMappings } from './reactionRoles.js';

const BAR_SIZE = 14;

export const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Check VDS latency.'),
  new SlashCommandBuilder().setName('rank').setDescription("Show a member's level and XP.").addUserOption(o => o.setName('user').setDescription('Member to inspect.').setRequired(false)),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Show the server XP leaderboard.'),
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
  const ratio = Math.min(1, Math.max(0, current / Math.max(1, required)));
  const filled = Math.round(ratio * BAR_SIZE);
  return `${'▰'.repeat(filled)}${'▱'.repeat(BAR_SIZE - filled)}`;
}

function rankEmbed(guild, user, rank) {
  const base = xpForLevel(rank.level);
  const next = xpForLevel(rank.level + 1);
  const progress = Math.max(0, rank.xp - base);
  const needed = Math.max(1, next - base);
  return new EmbedBuilder().setColor(0x5865F2)
    .setAuthor({ name: `${user.username}'s profile`, iconURL: user.displayAvatarURL({ size: 128 }) })
    .setTitle('Level Progress').setDescription(`**Level ${rank.level}**\n${bar(progress, needed)}`)
    .addFields(
      { name: 'XP', value: `**${rank.xp.toLocaleString()}** total`, inline: true },
      { name: 'Progress', value: `${progress.toLocaleString()} / ${needed.toLocaleString()}`, inline: true },
      { name: 'Next level', value: `**${Math.max(0, next - rank.xp).toLocaleString()}** XP`, inline: true }
    ).setFooter({ text: `VDS • ${guild.name}` });
}

export async function autocompleteReactionRole(interaction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const results = [];
  for (const emoji of interaction.guild.emojis.cache.values()) {
    if (!focused || emoji.name.toLowerCase().includes(focused) || emoji.id.includes(focused)) {
      results.push({ name: `${emoji.animated ? 'Animated ' : ''}:${emoji.name}:`, value: `${emoji.animated ? '<a:' : '<:'}${emoji.name}:${emoji.id}>` });
    }
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
    const rows = await getLeaderboard(interaction.guildId);
    const description = rows.length ? rows.map((r, i) => `**${String(i + 1).padStart(2, '0')}**  <@${r.user_id}>  •  Level **${r.level}**  •  ${Number(r.xp).toLocaleString()} XP`).join('\n') : 'No XP has been recorded yet.';
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('VDS • XP Leaderboard').setDescription(description).setFooter({ text: 'Top 10 members by total XP' })] });
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
      const emoji = interaction.options.getString('emoji', true);
      const role = interaction.options.getRole('role', true);
      const me = interaction.guild.members.me;
      if (!me || role.managed || role.position >= me.roles.highest.position) return interaction.reply({ content: 'That role cannot be managed by VDS. Put the bot role above it.', ephemeral: true });
      try { await message.react(emoji); await addMapping(interaction.guildId, messageId, emoji, role.id); }
      catch { return interaction.reply({ content: 'I could not add that reaction. Pick a server emoji from autocomplete or use a valid Unicode emoji.', ephemeral: true }); }
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('Reaction Role • Added').setDescription(`Reaction ${emoji} is now mapped to <@&${role.id}>.`).addFields({ name: 'Channel', value: `<#${channel.id}>`, inline: true }, { name: 'Role', value: `<@&${role.id}>`, inline: true })], ephemeral: true });
    }
    const emoji = interaction.options.getString('emoji', true);
    if (sub === 'remove') { await removeMapping(interaction.guildId, messageId, emoji); return interaction.reply({ content: `Removed ${emoji} from the reaction-role mapping.`, ephemeral: true }); }
    const mappings = await listMappings(interaction.guildId, messageId);
    if (!mappings.length) return interaction.reply({ content: 'No reaction-role mappings found for this message.', ephemeral: true });
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('Reaction Roles').setDescription(mappings.map(m => `${m.emoji_key}  →  <@&${m.role_id}>`).join('\n')).setFooter({ text: `${mappings.length} mapping${mappings.length === 1 ? '' : 's'}` })], ephemeral: true });
  }
}
