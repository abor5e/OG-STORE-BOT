const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionFlagsBits,
    REST,
    Routes,
    SlashCommandBuilder,
    AttachmentBuilder
} = require('discord.js');
const transcripts = require('discord-html-transcripts');
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(3000, () => console.log('Web server listening on port 3000'));

const TOKEN = process.env.TOKEN || process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN) { console.error('Missing TOKEN'); process.exit(1); }
if (!CLIENT_ID) { console.error('Missing CLIENT_ID'); process.exit(1); }

const configsDir = path.join(__dirname, 'configs');
if (!fs.existsSync(configsDir)) fs.mkdirSync(configsDir, { recursive: true });

function defaultGuildConfig() {
    return { logsChannelId: null, staffRoleId: null, categoryRoles: {}, channelCategories: {}, channelOwners: {}, ticketCount: 0, totalTickets: 0, closedCount: 0, claims: {}, channelClaimants: {} };
}

function loadGuildConfig(guildId) {
    const file = path.join(configsDir, guildId + '.json');
    if (!fs.existsSync(file)) return defaultGuildConfig();
    try { return Object.assign(defaultGuildConfig(), JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch { return defaultGuildConfig(); }
}

function saveGuildConfig(guildId, data) {
    try {
        if (!fs.existsSync(configsDir)) fs.mkdirSync(configsDir, { recursive: true });
        fs.writeFileSync(path.join(configsDir, guildId + '.json'), JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('saveGuildConfig error:', err.message);
    }
}

async function buildTranscript(channel, ticketNum) {
    return await transcripts.createTranscript(channel, {
        filename: 'ticket-' + ticketNum + '.html',
        saveImages: false,
        poweredBy: false
    });
}

function incrementGuildTicket(guildId) {
    const cfg = loadGuildConfig(guildId);
    cfg.ticketCount = (cfg.ticketCount || 0) + 1;
    cfg.totalTickets = (cfg.totalTickets || 0) + 1;
    saveGuildConfig(guildId, cfg);
    return cfg.totalTickets;
}

const commands = [
    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('إرسال لوحة التذاكر إلى هذه القناة')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('setup-logs')
        .setDescription('تحديد قناة إرسال سجلات التذاكر المغلقة')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(opt =>
            opt.setName('channel').setDescription('القناة المستهدفة').addChannelTypes(ChannelType.GuildText).setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('setup-staff')
        .setDescription('تحديد رتبة الإدارة العامة')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addRoleOption(opt => opt.setName('role').setDescription('رتبة الإدارة').setRequired(true)),

    new SlashCommandBuilder()
        .setName('setup-category')
        .setDescription('تخصيص رتبة لقسم تذاكر معين')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('ticket-stats')
        .setDescription('عرض إحصائيات التذاكر')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('reset-stats')
        .setDescription('إعادة تعيين إحصائيات التذاكر')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('remove-user')
        .setDescription('إزالة مستخدم من قناة التذكرة الحالية')
        .addUserOption(opt => opt.setName('user').setDescription('المستخدم المراد إزالته').setRequired(true)),

    new SlashCommandBuilder()
        .setName('close-ticket')
        .setDescription('إغلاق التذكرة الحالية وحفظ السجل'),

    new SlashCommandBuilder()
        .setName('add-user')
        .setDescription('إضافة مستخدم إلى قناة التذكرة الحالية')
        .addUserOption(opt => opt.setName('user').setDescription('المستخدم المراد إضافته').setRequired(true)),

    new SlashCommandBuilder()
        .setName('rename-ticket')
        .setDescription('إعادة تسمية قناة التذكرة الحالية')
        .addStringOption(opt => opt.setName('name').setDescription('الاسم الجديد').setRequired(true)),

    new SlashCommandBuilder()
        .setName('help')
        .setDescription('عرض جميع أوامر الإدارة')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName('staff-help')
        .setDescription('عرض أوامر الإدارة'),
].map(cmd => cmd.toJSON());

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.on('error', err => console.error('Client error:', err.message));
process.on('unhandledRejection', err => console.error('Unhandled rejection:', err.message));

client.once('ready', async () => {
    console.log('جاهز: ' + client.user.tag);
    try {
        const rest = new REST().setToken(TOKEN);
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('تم تسجيل الأوامر.');
    } catch (err) {
        console.error('فشل تسجيل الأوامر:', err.message);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.guild) return;
    const guildId = interaction.guild.id;

    // ─── أوامر السلاش ─────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'ticket') {
            const bannerPath = path.join(__dirname, 'assets', 'og-store-banner.png');
            const menu = new StringSelectMenuBuilder()
                .setCustomId('ticket-menu')
                .setPlaceholder('اختر نوع طلبك...')
                .addOptions([
                    { label: 'شراء', description: 'طلب شراء منتج من المتجر', value: 'purchase', emoji: '\uD83D\uDED2' },
                    { label: 'استفسار', description: 'استفسار عن منتج أو خدمة', value: 'inquiry', emoji: '\uD83D\uDCAC' },
                    { label: 'شكوى', description: 'تقديم شكوى أو مشكلة في طلب سابق', value: 'complaint', emoji: '\u26A0\uFE0F' },
                    { label: 'عروض وباقات', description: 'الاستفسار عن العروض والباقات المتاحة', value: 'offers', emoji: '\uD83C\uDFF7\uFE0F' },
                ]);

            const row = new ActionRowBuilder().addComponents(menu);

            if (fs.existsSync(bannerPath)) {
                const attachment = new AttachmentBuilder(bannerPath, { name: 'og-store-banner.png' });
                await interaction.reply({ files: [attachment], components: [row] });
            } else {
                await interaction.reply({ content: '\uD83D\uDED2 **OG Store** — اختر نوع طلبك:', components: [row] });
            }
            return;
        }

        if (commandName === 'setup-logs') {
            const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
            const cfg = loadGuildConfig(guildId);
            cfg.logsChannelId = targetChannel.id;
            saveGuildConfig(guildId, cfg);
            await interaction.reply({ embeds: [new EmbedBuilder().setDescription('\u2705 تم تعيين <#' + targetChannel.id + '> كقناة سجلات.').setColor(0x57F287)], flags: 64 });
            return;
        }

        if (commandName === 'setup-staff') {
            const role = interaction.options.getRole('role');
            const cfg = loadGuildConfig(guildId);
            cfg.staffRoleId = role.id;
            saveGuildConfig(guildId, cfg);
            await interaction.reply({ embeds: [new EmbedBuilder().setDescription('\u2705 تم تعيين <@&' + role.id + '> كرتبة إدارة.').setColor(0x57F287)], flags: 64 });
            return;
        }

        if (commandName === 'setup-category') {
            const catEmbed = new EmbedBuilder().setTitle('\u2699\uFE0F تخصيص رتبة للقسم').setDescription('اختر القسم:').setColor(0x2ECC71);
            const catMenu = new StringSelectMenuBuilder()
                .setCustomId('setup-category-select')
                .setPlaceholder('اختر قسماً...')
                .addOptions([
                    { label: 'شراء', value: 'purchase', emoji: '\uD83D\uDED2' },
                    { label: 'استفسار', value: 'inquiry', emoji: '\uD83D\uDCAC' },
                    { label: 'شكوى', value: 'complaint', emoji: '\u26A0\uFE0F' },
                    { label: 'عروض وباقات', value: 'offers', emoji: '\uD83C\uDFF7\uFE0F' },
                ]);
            await interaction.reply({ embeds: [catEmbed], components: [new ActionRowBuilder().addComponents(catMenu)], flags: 64 });
            return;
        }

        if (commandName === 'ticket-stats') {
            const cfg = loadGuildConfig(guildId);
            const sortedClaims = Object.entries(cfg.claims || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
            let claimsValue = 'لا توجد بيانات بعد';
            if (sortedClaims.length > 0) claimsValue = sortedClaims.map((e, i) => (i + 1) + '. <@' + e[0] + '> — **' + e[1] + '** استلامات').join('\n');
            const statsEmbed = new EmbedBuilder()
                .setTitle('\uD83D\uDCCA إحصائيات التذاكر')
                .addFields(
                    { name: '\uD83D\uDCE5 إجمالي المفتوحة', value: String(cfg.ticketCount || 0), inline: true },
                    { name: '\uD83D\uDD12 إجمالي المغلقة', value: String(cfg.closedCount || 0), inline: true },
                    { name: '\uD83D\uDFE1 النشطة حالياً', value: String(Math.max(0, (cfg.ticketCount || 0) - (cfg.closedCount || 0))), inline: true },
                    { name: '\uD83D\uDC64 أفضل الإدارة', value: claimsValue }
                )
                .setColor(0x2ECC71).setTimestamp();
            await interaction.reply({ embeds: [statsEmbed], flags: 64 });
            return;
        }

        if (commandName === 'reset-stats') {
            const cfg = loadGuildConfig(guildId);
            cfg.ticketCount = 0; cfg.closedCount = 0; cfg.claims = {};
            saveGuildConfig(guildId, cfg);
            await interaction.reply({ embeds: [new EmbedBuilder().setDescription('\u2705 تم إعادة تعيين الإحصائيات.').setColor(0xED4245).setTimestamp()], flags: 64 });
            return;
        }

        if (commandName === 'close-ticket') {
            const channel = interaction.channel;
            const cfg = loadGuildConfig(guildId);
            const closer = interaction.member;
            const isAdmin = closer.permissions.has(PermissionFlagsBits.Administrator);
            const hasStaffRole = cfg.staffRoleId && closer.roles.cache.has(cfg.staffRoleId);
            if (!isAdmin && !hasStaffRole) { await interaction.reply({ content: 'هذا الأمر للإدارة فقط.', flags: 64 }); return; }
            const claimantId = cfg.channelClaimants && cfg.channelClaimants[channel.id];
            if (claimantId && !isAdmin && closer.id !== claimantId) {
                await interaction.reply({ content: '\u274C فقط عضو الإدارة الذي استلم التذكرة (<@' + claimantId + '>) أو الإدارة يمكنهم الإغلاق.', flags: 64 });
                return;
            }
            const channelName = channel.name;
            const ticketNum = channelName.replace(/[^0-9]/g, '') || '?';
            const ownerId = cfg.channelOwners && cfg.channelOwners[channel.id];
            try { await interaction.deferReply(); } catch { return; }
            const transcript = await buildTranscript(channel, ticketNum);
            if (cfg.logsChannelId) {
                const logsChannel = channel.guild.channels.cache.get(cfg.logsChannelId);
                if (logsChannel) {
                    await logsChannel.send({ embeds: [new EmbedBuilder().setTitle('\uD83D\uDCCB سجل التذكرة #' + ticketNum).addFields({ name: '\uD83D\uDC64 الصاحب', value: ownerId ? '<@' + ownerId + '>' : 'غير معروف', inline: true }, { name: '\uD83D\uDD12 أُغلقت بواسطة', value: '<@' + closer.id + '>', inline: true }, { name: '\uD83D\uDCC1 القناة', value: channelName, inline: true }).setColor(0xED4245).setTimestamp()], files: [transcript] });
                }
            }
            const closeCfg = loadGuildConfig(guildId);
            closeCfg.closedCount = (closeCfg.closedCount || 0) + 1;
            if (closeCfg.channelClaimants) delete closeCfg.channelClaimants[channel.id];
            if (closeCfg.channelOwners) delete closeCfg.channelOwners[channel.id];
            saveGuildConfig(guildId, closeCfg);
            await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('\uD83D\uDD12 تم إغلاق التذكرة').setDescription('سيتم حذف هذه القناة خلال 5 ثواني.').setColor(0xED4245).setTimestamp()] });
            setTimeout(async () => { await channel.delete().catch(() => null); }, 5000);
            return;
        }

        if (commandName === 'remove-user') {
            const channel = interaction.channel;
            const cfg = loadGuildConfig(guildId);
            const requester = interaction.member;
            const isAdmin = requester.permissions.has(PermissionFlagsBits.Administrator);
            const hasStaffRole = cfg.staffRoleId && requester.roles.cache.has(cfg.staffRoleId);
            if (!isAdmin && !hasStaffRole) { await interaction.reply({ content: 'هذا الأمر للإدارة فقط.', flags: 64 }); return; }
            const targetUser = interaction.options.getUser('user');
            const ownerId = cfg.channelOwners && cfg.channelOwners[channel.id];
            const claimantId = cfg.channelClaimants && cfg.channelClaimants[channel.id];
            if (targetUser.id === ownerId) { await interaction.reply({ content: '\u274C لا يمكنك إزالة صاحب التذكرة.', flags: 64 }); return; }
            if (targetUser.id === claimantId) { await interaction.reply({ content: '\u274C لا يمكنك إزالة عضو الإدارة المستلمة.', flags: 64 }); return; }
            if (!channel.permissionOverwrites.cache.get(targetUser.id)) { await interaction.reply({ content: '\u274C هذا المستخدم لم يُضف إلى التذكرة.', flags: 64 }); return; }
            await channel.permissionOverwrites.delete(targetUser.id);
            await interaction.reply({ embeds: [new EmbedBuilder().setDescription('\u2705 تم إزالة <@' + targetUser.id + '> من التذكرة.').setColor(0xED4245)] });
            return;
        }

        if (commandName === 'add-user') {
            const channel = interaction.channel;
            const cfg = loadGuildConfig(guildId);
            const requester = interaction.member;
            const isAdmin = requester.permissions.has(PermissionFlagsBits.Administrator);
            const hasStaffRole = cfg.staffRoleId && requester.roles.cache.has(cfg.staffRoleId);
            const isTicketOwner = cfg.channelOwners && cfg.channelOwners[channel.id] === requester.id;
            if (!isAdmin && !hasStaffRole && !isTicketOwner) { await interaction.reply({ content: 'هذا الأمر للإدارة وصاحب التذكرة فقط.', flags: 64 }); return; }
            const targetUser = interaction.options.getUser('user');
            const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
            if (!targetMember) { await interaction.reply({ content: '\u274C العضو غير موجود في السيرفر.', flags: 64 }); return; }
            await channel.permissionOverwrites.edit(targetMember.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
            await interaction.reply({ embeds: [new EmbedBuilder().setDescription('\u2705 تم إضافة <@' + targetUser.id + '> إلى التذكرة.').setColor(0x57F287)] });
            return;
        }

        if (commandName === 'rename-ticket') {
            const channel = interaction.channel;
            const cfg = loadGuildConfig(guildId);
            const requester = interaction.member;
            const isAdmin = requester.permissions.has(PermissionFlagsBits.Administrator);
            const hasStaffRole = cfg.staffRoleId && requester.roles.cache.has(cfg.staffRoleId);
            const claimantId = cfg.channelClaimants && cfg.channelClaimants[channel.id];
            if (!isAdmin && !hasStaffRole && requester.id !== claimantId) { await interaction.reply({ content: '\u274C فقط الإدارة المستلمة أو الإدارة يمكنهم إعادة التسمية.', flags: 64 }); return; }
            const newName = interaction.options.getString('name').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '').slice(0, 100);
            if (!newName) { await interaction.reply({ content: '\u274C اسم غير صالح.', flags: 64 }); return; }
            const oldName = channel.name;
            await channel.setName(newName).catch(() => null);
            await interaction.reply({ embeds: [new EmbedBuilder().setDescription('\u270F\uFE0F تم التغيير من `' + oldName + '` إلى `' + newName + '`.').setColor(0x2ECC71).setTimestamp()] });
            return;
        }

        if (commandName === 'help') {
            await interaction.reply({
                embeds: [new EmbedBuilder().setTitle('\uD83D\uDCCB أوامر الإدارة').addFields(
                    { name: '`/ticket`', value: 'إرسال لوحة التذاكر مع صورة المتجر' },
                    { name: '`/setup-logs`', value: 'تحديد قناة السجلات' },
                    { name: '`/setup-staff`', value: 'تحديد رتبة الإدارة العامة' },
                    { name: '`/setup-category`', value: 'تخصيص رتبة لكل قسم' },
                    { name: '`/close-ticket`', value: 'إغلاق التذكرة وحفظ السجل' },
                    { name: '`/rename-ticket`', value: 'إعادة تسمية قناة التذكرة' },
                    { name: '`/add-user`', value: 'إضافة مستخدم للتذكرة' },
                    { name: '`/remove-user`', value: 'إزالة مستخدم من التذكرة' },
                    { name: '`/ticket-stats`', value: 'الإحصائيات' },
                    { name: '`/reset-stats`', value: 'إعادة تعيين الإحصائيات' },
                ).setColor(0x2ECC71).setFooter({ text: 'أوامر الإدارة فقط' }).setTimestamp()],
                flags: 64
            });
            return;
        }

        if (commandName === 'staff-help') {
            const cfg = loadGuildConfig(guildId);
            const member = interaction.member;
            const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
            const hasStaffRole = cfg.staffRoleId && member.roles.cache.has(cfg.staffRoleId);
            const hasCategoryRole = cfg.categoryRoles && Object.values(cfg.categoryRoles).some(rid => member.roles.cache.has(rid));
            if (!isAdmin && !hasStaffRole && !hasCategoryRole) { await interaction.reply({ content: 'هذا الأمر للإدارة فقط.', flags: 64 }); return; }
            await interaction.reply({
                embeds: [new EmbedBuilder().setTitle('\uD83D\uDCCB أوامر الإدارة').setDescription('الأوامر المتاحة داخل التذاكر:').addFields(
                    { name: '\uD83D\uDD35 استلام التذكرة', value: 'اضغط زر **استلام** لتسجيلك كالمسؤول عنها' },
                    { name: '`/close-ticket`', value: 'إغلاق التذكرة — للإدارة المستلمة فقط' },
                    { name: '`/rename-ticket`', value: 'إعادة تسمية القناة — للإدارة المستلمة فقط' },
                    { name: '`/add-user`', value: 'إضافة شخص للتذكرة' },
                    { name: '`/remove-user`', value: 'إزالة شخص من التذكرة' },
                ).setColor(0x2ECC71).setFooter({ text: 'استلام التذكرة أولاً قبل أي إجراء' }).setTimestamp()],
                flags: 64
            });
            return;
        }

        return;
    }

    // ─── قائمة التذاكر ────────────────────────────────────────────────────────
    if (interaction.isStringSelectMenu() && interaction.customId === 'ticket-menu') {
        try { await interaction.deferReply({ flags: 64 }); } catch { return; }

        try {
            const cfg = loadGuildConfig(guildId);
            const ticketNumber = incrementGuildTicket(guildId);
            const guild = interaction.guild;
            const member = interaction.member;
            const selectedValue = interaction.values[0];

            const categoryLabels = {
                'purchase': 'شراء',
                'inquiry': 'استفسار',
                'complaint': 'شكوى',
                'offers': 'عروض وباقات'
            };

            const categoryEmojis = {
                'purchase': '\uD83D\uDED2',
                'inquiry': '\uD83D\uDCAC',
                'complaint': '\u26A0\uFE0F',
                'offers': '\uD83C\uDFF7\uFE0F'
            };

            const channelName = (categoryEmojis[selectedValue] || '\uD83C\uDFAB') + '-ticket-' + ticketNumber;
            const categoryRoleId = cfg.categoryRoles && cfg.categoryRoles[selectedValue];
            const activeRoleId = categoryRoleId || cfg.staffRoleId;

            const permissionOverwrites = [
                { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
            ];

            if (activeRoleId) {
                permissionOverwrites.push({ id: activeRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
            }

            guild.roles.cache.filter(r => r.permissions.has(PermissionFlagsBits.Administrator) && r.id !== activeRoleId).forEach(r => {
                permissionOverwrites.push({ id: r.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] });
            });

            const channel = await guild.channels.create({ name: channelName, type: ChannelType.GuildText, permissionOverwrites });

            const ticketEmbed = new EmbedBuilder()
                .setTitle((categoryEmojis[selectedValue] || '\uD83C\uDFAB') + ' تذكرة #' + ticketNumber)
                .addFields(
                    { name: 'القسم', value: categoryLabels[selectedValue] || selectedValue, inline: true },
                    { name: 'فُتحت بواسطة', value: '<@' + member.id + '>', inline: true },
                    { name: 'الحالة', value: 'مفتوحة — في انتظار الإدارة', inline: true }
                )
                .setDescription('أهلاً بك في **OG Store**! يرجى شرح طلبك وسيتولى أحد الإدارة مساعدتك قريباً.')
                .setColor(0x2ECC71)
                .setTimestamp();

            const claimButton = new ButtonBuilder()
                .setCustomId('claim-ticket:' + ticketNumber + ':' + member.id)
                .setLabel('استلام التذكرة')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('\uD83D\uDC64');

            const closeButton = new ButtonBuilder()
                .setCustomId('close-ticket:' + ticketNumber + ':' + member.id)
                .setLabel('إغلاق التذكرة')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('\uD83D\uDD12');

            const pings = ['<@' + member.id + '>'];
            if (activeRoleId) pings.push('<@&' + activeRoleId + '>');

            await channel.send({ content: pings.join(' '), embeds: [ticketEmbed], components: [new ActionRowBuilder().addComponents(claimButton, closeButton)] });

            const openCfg = loadGuildConfig(guildId);
            if (!openCfg.channelOwners) openCfg.channelOwners = {};
            openCfg.channelOwners[channel.id] = member.id;
            if (!openCfg.channelCategories) openCfg.channelCategories = {};
            openCfg.channelCategories[channel.id] = selectedValue;
            saveGuildConfig(guildId, openCfg);

            await interaction.editReply({ content: 'تم فتح تذكرتك: <#' + channel.id + '>' });

        } catch (err) {
            console.error('[ticket-create error]', err);
            try { await interaction.editReply({ content: '\u274C خطأ: `' + (err && err.message ? err.message : String(err)) + '`' }); } catch {}
        }

        return;
    }

    // ─── setup-category: الخطوة 1 ─────────────────────────────────────────────
    if (interaction.isStringSelectMenu() && interaction.customId === 'setup-category-select') {
        const selectedCat = interaction.values[0];
        const categoryLabels = { 'purchase': 'شراء', 'inquiry': 'استفسار', 'complaint': 'شكوى', 'offers': 'عروض وباقات' };
        const roleMenu = new RoleSelectMenuBuilder().setCustomId('setup-category-role:' + selectedCat).setPlaceholder('اختر رتبة...');
        await interaction.update({
            embeds: [new EmbedBuilder().setTitle('\u2699\uFE0F تخصيص رتبة').setDescription('القسم: **' + categoryLabels[selectedCat] + '**\n\nاختر الرتبة:').setColor(0x2ECC71)],
            components: [new ActionRowBuilder().addComponents(roleMenu)]
        });
        return;
    }

    // ─── setup-category: الخطوة 2 ─────────────────────────────────────────────
    if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('setup-category-role:')) {
        const selectedCat = interaction.customId.split(':')[1];
        const selectedRole = interaction.roles.first();
        const categoryLabels = { 'purchase': 'شراء', 'inquiry': 'استفسار', 'complaint': 'شكوى', 'offers': 'عروض وباقات' };
        const cfg = loadGuildConfig(guildId);
        if (!cfg.categoryRoles) cfg.categoryRoles = {};
        cfg.categoryRoles[selectedCat] = selectedRole.id;
        saveGuildConfig(guildId, cfg);
        await interaction.update({
            embeds: [new EmbedBuilder().setTitle('\u2705 تم التخصيص').setDescription('القسم **' + categoryLabels[selectedCat] + '** \u2192 <@&' + selectedRole.id + '>').setColor(0x57F287).setTimestamp()],
            components: []
        });
        return;
    }

    // ─── زر الاستلام ────────────────────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('claim-ticket:')) {
        const parts = interaction.customId.split(':');
        const ticketNumber = parts[1];
        const ownerId = parts[2];
        const claimant = interaction.member;
        const channel = interaction.channel;
        const cfg = loadGuildConfig(guildId);

        const isAdmin = claimant.permissions.has(PermissionFlagsBits.Administrator);
        const channelCat = cfg.channelCategories && cfg.channelCategories[channel.id];
        const catRoleId = channelCat && cfg.categoryRoles && cfg.categoryRoles[channelCat];
        const hasStaffRole = (cfg.staffRoleId && claimant.roles.cache.has(cfg.staffRoleId)) || (catRoleId && claimant.roles.cache.has(catRoleId));

        if (!isAdmin && !hasStaffRole) {
            try { await interaction.reply({ content: 'فقط الإدارة المخصصة لهذا القسم يمكنهاا الاستلام.', flags: 64 }); } catch {}
            return;
        }

        try {
            await interaction.message.edit({ components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('close-ticket:' + ticketNumber + ':' + ownerId + ':' + claimant.id).setLabel('إغلاق التذكرة').setStyle(ButtonStyle.Danger).setEmoji('\uD83D\uDD12'))] });

            const claimCfg = loadGuildConfig(guildId);
            if (!claimCfg.claims) claimCfg.claims = {};
            claimCfg.claims[claimant.id] = (claimCfg.claims[claimant.id] || 0) + 1;
            if (!claimCfg.channelClaimants) claimCfg.channelClaimants = {};
            claimCfg.channelClaimants[channel.id] = claimant.id;
            saveGuildConfig(guildId, claimCfg);

            const claimOverwrites = [
                { id: channel.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                { id: claimant.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] }
            ];

            const activeStaffRoleId = (channelCat && claimCfg.categoryRoles && claimCfg.categoryRoles[channelCat]) || claimCfg.staffRoleId;
            if (activeStaffRoleId && activeStaffRoleId !== claimant.id) {
                claimOverwrites.push({ id: activeStaffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] });
            }

            channel.guild.roles.cache.filter(r => r.permissions.has(PermissionFlagsBits.Administrator)).forEach(r => {
                claimOverwrites.push({ id: r.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] });
            });

            await channel.permissionOverwrites.set(claimOverwrites);
            await interaction.reply({ embeds: [new EmbedBuilder().setDescription('\uD83D\uDC64 تم الاستلام بواسطة <@' + claimant.id + '>.\nسيتولى طلبك.').setColor(0x2ECC71).setTimestamp()] });
        } catch (err) { console.error('Claim error:', err.message); }
        return;
    }

    // ─── زر الإغلاق ───────────────────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('close-ticket:')) {
        const parts = interaction.customId.split(':');
        const ticketNumber = parts[1];
        const ownerId = parts[2];
        const claimantId = parts[3] || null;
        const closer = interaction.member;
        const channel = interaction.channel;
        const cfg = loadGuildConfig(guildId);

        const isAdmin = closer.permissions.has(PermissionFlagsBits.Administrator);
        const closeChannelCat = cfg.channelCategories && cfg.channelCategories[channel.id];
        const closeCatRoleId = closeChannelCat && cfg.categoryRoles && cfg.categoryRoles[closeChannelCat];
        const hasStaffRole = (cfg.staffRoleId && closer.roles.cache.has(cfg.staffRoleId)) || (closeCatRoleId && closer.roles.cache.has(closeCatRoleId));

        if (!isAdmin && !hasStaffRole) {
            try { await interaction.reply({ content: 'فقط الإدارة يمكنها إغلاق التذكرة.', flags: 64 }); } catch {}
            return;
        }

        if (claimantId && !isAdmin && closer.id !== claimantId) {
            try { await interaction.reply({ content: '\u274C فقط عضو الإدارة المستلمة (<@' + claimantId + '>) أو الإدارة يمكنهم الإغلاق.', flags: 64 }); } catch {}
            return;
        }

        try { await interaction.deferReply(); } catch { return; }

        const transcript = await buildTranscript(channel, ticketNumber);

        if (cfg.logsChannelId) {
            const logsChannel = channel.guild.channels.cache.get(cfg.logsChannelId);
            if (logsChannel) {
                await logsChannel.send({ embeds: [new EmbedBuilder().setTitle('\uD83D\uDCCB سجل التذكرة #' + ticketNumber).addFields({ name: '\uD83D\uDC64 الصاحب', value: ownerId ? '<@' + ownerId + '>' : 'غير معروف', inline: true }, { name: '\uD83D\uDD12 أُغلقت بواسطة', value: '<@' + closer.id + '>', inline: true }, { name: '\uD83D\uDCC1 القناة', value: channel.name, inline: true }).setColor(0xED4245).setTimestamp()], files: [transcript] });
            }
        }

        const closeCfg = loadGuildConfig(guildId);
        closeCfg.closedCount = (closeCfg.closedCount || 0) + 1;
        if (closeCfg.channelClaimants) delete closeCfg.channelClaimants[channel.id];
        if (closeCfg.channelOwners) delete closeCfg.channelOwners[channel.id];
        saveGuildConfig(guildId, closeCfg);

        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle('\uD83D\uDD12 تم إغلاق التذكرة').setDescription('سيتم حذف هذه القناة خلال 5 ثواني.').setColor(0xED4245).setTimestamp()] });
        setTimeout(async () => { await channel.delete('أُغلقت بواسطة ' + closer.user.tag).catch(() => null); }, 5000);
        return;
    }
});

client.login(TOKEN);
