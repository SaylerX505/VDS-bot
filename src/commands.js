import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { joinVoiceChannel, getVoiceConnection } from '@discordjs/voice';
import { getLeaderboard, getRank, xpForLevel } from './levels.js';
import { addMapping, removeMapping, listMappings } from './reactionRoles.js';

export const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Check VDS latency.'),
  new SlashCommandBuilder().setName('rank').setDescription('Show a member\'s level and XP.')
    .addUserOption(o => o.setName('user').setDescription('Member to inspect.').setRequired(false)),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Show the server XP leaderboard.'),
  new SlashCommandBuilder().setName('join').setDescription('Join your current voice channel.'),
  new SlashCommandBuilder().setName('leave').setDescription('Leave the current voice channel.'),
  new SlashCommandBuilder().setName('reactionrole').setDescription('Manage reaction roles.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(s => s.setName('add').setDescription('Map a reaction on a message to a role.')
      .addStringOption(o => o.setName('message').setDescription('Target message ID.').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('Emoji, including custom emoji ID format name:id.').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role to grant/remove.').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove a reaction-role mapping.')
      .addStringOption(o => o.setName('message').setDescription('Target message ID.').setRequired(true))
      .addStringOption(o => o.setName('emoji').setDescription('Emoji key.').setRequired(true)))
    .addSubcommand(s => s.setName('list').setDescription('List mappings for a message.')
      .addStringOption(o => o.setName('message').setDescription('Target message ID.').setRequired(true)))
].map(c => c.toJSON());

function formatXp(rank) {
  const next = xpForLevel(rank.level + 1);
  return `${rank.xp} XP • Level ${rank.level} • ${Math.max(0, next - rank.xp)} XP to next level`;
}

export async function handleCommand(interaction) {
  if (!interaction.guild) return interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });

  if (interaction.commandName === 'ping') {
    return interaction.reply(`Pong — ${interaction.client.ws.ping}ms.`);
  }

  if (interaction.commandName === 'rank') {
    const user = interaction.options.getUser('user') || interaction.user;
    const rank = await getRank(interaction.guildId, user.id);
    return interaction.reply(`**${user.username}** — ${formatXp(rank)}`);
  }

  if (interaction.commandName === 'leaderboard') {
    const rows = await getLeaderboard(interaction.guildId);
    if (!rows.length) return interaction.reply('No XP has been recorded yet.');
    const text = rows.map((r, i) => `**${i + 1}.** <@${r.user_id}> — Level ${r.level} (${r.xp} XP)`).join('\n');
    return interaction.reply(`**VDS XP Leaderboard**\n${text}`);
  }

  if (interaction.commandName === 'join') {
    const channel = interaction.member.voice.channel;
    if (!channel) return interaction.reply({ content: 'Join a voice channel first.', ephemeral: true });
    const existing = getVoiceConnection(interaction.guildId);
    existing?.destroy();
    joinVoiceChannel({ channelId: channel.id, guildId: interaction.guildId, adapterCreator: interaction.guild.voiceAdapterCreator, selfDeaf: true });
    return interaction.reply(`Joined **${channel.name}**.`);
  }

  if (interaction.commandName === 'leave') {
    const connection = getVoiceConnection(interaction.guildId);
    if (!connection) return interaction.reply({ content: 'I am not in a voice channel.', ephemeral: true });
    connection.destroy();
    return interaction.reply('Left the voice channel.');
  }

  if (interaction.commandName === 'reactionrole') {
    const sub = interaction.options.getSubcommand();
    const messageId = interaction.options.getString('message', true);
    const emoji = interaction.options.getString('emoji', true);
    const channel = interaction.channel;
    let message;
    try { message = await channel.messages.fetch(messageId); } catch { return interaction.reply({ content: 'I could not fetch that message from this channel.', ephemeral: true }); }

    if (sub === 'add') {
      const role = interaction.options.getRole('role', true);
      if (role.managed || role.position >= interaction.guild.members.me.roles.highest.position) {
        return interaction.reply({ content: 'That role cannot be managed by VDS. Put the bot role above it.', ephemeral: true });
      }
      await addMapping(interaction.guildId, messageId, emoji, role.id);
      try { await message.react(emoji); } catch { return interaction.reply({ content: 'Mapping saved, but I could not add that reaction. Check the emoji and permissions.', ephemeral: true }); }
      return interaction.reply({ content: `Mapped ${emoji} → <@&${role.id}> on [that message].`, ephemeral: true });
    }

    if (sub === 'remove') {
      await removeMapping(interaction.guildId, messageId, emoji);
      return interaction.reply({ content: `Removed ${emoji} from the reaction-role mapping.`, ephemeral: true });
    }

    const mappings = await listMappings(interaction.guildId, messageId);
    if (!mappings.length) return interaction.reply({ content: 'No mappings found.', ephemeral: true });
    return interaction.reply({ content: mappings.map(m => `${m.emoji_key} → <@&${m.role_id}>`).join('\n'), ephemeral: true });
  }
}
