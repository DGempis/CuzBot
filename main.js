const Discord = require('discord.js');

const client = new Discord.Client({ intents: ["GUILDS", "GUILD_MESSAGES"] });

client.once('ready', () => {
    console.log('CuzBot is online!');
})

// Checks if message is music bot command or response, and deletes it

client.on('message', async message => {
    try {
      if (!('guild' in message) || !message.guild) return; // prevent private messages to bot
      const mapKey = message.guild.id;
      if (message.content.trim().toLowerCase() == _CMD_JOIN) {
          if (!message.member.voice.channelID) {
              message.reply('Error: please join a voice channel first.')
          } else {
              if (!guildMap.has(mapKey))
                  await connect(message, mapKey)
              else
                  message.reply('Already connected')
          }
      } else if (message.content.trim().toLowerCase() == _CMD_LEAVE) {
          if (guildMap.has(mapKey)) {
              let val = guildMap.get(mapKey);
              if (val.voice_Channel) val.voice_Channel.leave()
              if (val.voice_Connection) val.voice_Connection.disconnect()
              if (val.musicYTStream) val.musicYTStream.destroy()
                  guildMap.delete(mapKey)
              message.reply("Disconnected.")
          } else {
              message.reply("Cannot leave because not connected.")
          }
      } else if (message.content.trim().toLowerCase() == _CMD_HELP) {
          message.reply(getHelpString());
      }
      else if (message.content.trim().toLowerCase() == _CMD_DEBUG) {
          console.log('toggling debug mode')
          let val = guildMap.get(mapKey);
          if (val.debug)
              val.debug = false;
          else
              val.debug = true;
      }
      else if (message.content.trim().toLowerCase() == _CMD_TEST) {
          message.channel.send('-play kacey musgraves high horse')
      }
  } catch (e) {
      console.log('discordClient message: ' + e)
      message.reply('Error#180: Something went wrong, try again or contact the developers if this keeps happening.');
  }

function getHelpString() {
  let out = '**COMMANDS:**\n'
      out += '```'
      out += PREFIX + 'join\n';
      out += PREFIX + 'leave\n';
      out += '```'
  return out;
}

async function connect(msg, mapKey) {
  var silence = new Silence();
  try {
      let voice_Channel = await client.channels.fetch(msg.member.voice.channelID);
      if (!voice_Channel) return msg.reply("Error: The voice channel does not exist!");
      let text_Channel = await client.channels.fetch(msg.channel.id);
      if (!text_Channel) return msg.reply("Error: The text channel does not exist!");

      let voice_Connection = await voice_Channel.join();
      voice_Connection.play(silence, { type: 'opus' });
      guildMap.set(mapKey, {
          'text_Channel': text_Channel,
          'voice_Channel': voice_Channel,
          'voice_Connection': voice_Connection,
          'musicQueue': [],
          'musicDispatcher': null,
          'musicYTStream': null,
          'currentPlayingTitle': null,
          'currentPlayingQuery': null,
          'debug': false,
      });
      speak_impl(voice_Connection, mapKey)
      voice_Connection.on('disconnect', async(e) => {
          if (e) console.log(e);
          guildMap.delete(mapKey);
      })
      msg.reply('connected!')
  } catch (e) {
      console.log('connect: ' + e)
      msg.reply('Error: unable to join your voice channel.');
      throw e;
  }
}


function speak_impl(voice_Connection, mapKey) {
  voice_Connection.on('speaking', async (user, speaking) => {
      if (speaking.bitfield == 0 /*|| user.bot*/) {
          return
      }
      console.log(`I'm listening to ${user.username}`)

      const filename = './temp/audio_' + mapKey + '_' + user.username.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_' + Date.now() + '.tmp';
      let ws = fs.createWriteStream(filename);

      // this creates a 16-bit signed PCM, stereo 48KHz stream
      const audioStream = voice_Connection.receiver.createStream(user, { mode: 'pcm' })
      audioStream.pipe(ws)

      audioStream.on('error',  (e) => { 
          console.log('audioStream: ' + e)
      });
      ws.on('error',  (e) => { 
          console.log('ws error: ' + e)
      });
      audioStream.on('end', async () => {
          const stats = fs.statSync(filename);
          const fileSizeInBytes = stats.size;
          const duration = fileSizeInBytes / 48000 / 4;
          console.log("duration: " + duration)

          if (duration < 0.5 || duration > 19) {
              console.log("TOO SHORT / TOO LONG; SKPPING")
              fs.unlinkSync(filename)
              return;
          }

          const newfilename = filename.replace('.tmp', '.raw');
          fs.rename(filename, newfilename, (err) => {
              if (err) {
                  console.log('ERROR270:' + err)
                  fs.unlinkSync(filename)
              } else {
                  let val = guildMap.get(mapKey)
                  const infile = newfilename;
                  const outfile = newfilename + '.wav';
                  try {
                      convert_audio(infile, outfile, async () => {
                          let out = await transcribe_witai(outfile);
                          if (out != null)
                              process_commands_query(out, mapKey, user);
                          if (!val.debug) {
                              fs.unlinkSync(infile)
                              fs.unlinkSync(outfile)
                          }
                      })
                  } catch (e) {
                      console.log('tmpraw rename: ' + e)
                      if (!val.debug) {
                          fs.unlinkSync(infile)
                          fs.unlinkSync(outfile)
                      }
                  }
              }

          });


      })
  })
}

function process_commands_query(txt, mapKey, user) {
  if (txt && txt.length) {
      let val = guildMap.get(mapKey);
      val.text_Channel.send(user.username + ': ' + txt)
  }
}

//////////////////////////////////////////
//////////////// SPEECH //////////////////
//////////////////////////////////////////
let witAI_lastcallTS = null;
const witClient = require('node-witai-speech');
async function transcribe_witai(file) {
    try {
        // ensure we do not send more than one request per second
        if (witAI_lastcallTS != null) {
            let now = Math.floor(new Date());    
            while (now - witAI_lastcallTS < 1000) {
                console.log('sleep')
                await sleep(100);
                now = Math.floor(new Date());
            }
        }
    } catch (e) {
        console.log('transcribe_witai 837:' + e)
    }

    try {
        console.log('transcribe_witai')
        const extractSpeechIntent = util.promisify(witClient.extractSpeechIntent);
        var stream = fs.createReadStream(file);
        const output = await extractSpeechIntent(witAPIKEY, stream, "audio/wav")
        witAI_lastcallTS = Math.floor(new Date());
        console.log(output)
        stream.destroy()
        if (output && '_text' in output && output._text.length)
            return output._text
        if (output && 'text' in output && output.text.length)
            return output.text
        return output;
    } catch (e) { console.log('transcribe_witai 851:' + e) }
}
//////////////////////////////////////////
//////////////////////////////////////////
//////////////////////////////////////////

    /*
    if(message.content.toLowerCase().startsWith("?play")) {
        let voiceChannel = message.guild.channels.find(channel => channel.id === '133104742254510080');
        if(voiceChannel != null) {
            console.log(voiceChannel.name + ' was found and is a ' + voiceChannel.type + ' channel.');
            voiceChannel.join()
            .then(connection => {
                console.log('NgoBot joined the channel.');
                const stream = ydtl('https://www.youtube.com/watch?v=MUINFs1Sp94', { filter : 'audioonly' });
                const dispatcher = connection.playStream(stream, streamOptions);
            })
            .catch();
        }
    }
    */      
    // bigmoist
    if(message.guild.id === '133104742254510080') {
        // TikTok Repost
        if(message.content.indexOf('tiktok.com') !== -1 && message.channel.id !== '902230023786864691') {
            message.delete({ timeout: 0 })
            .catch(console.error);
            if (message.channel.type === 'text') {
                var logger = message.guild.channels.cache.find(
                channel => channel.id === '902230023786864691'
                );
                if (logger) {
                    const embed = new Discord.MessageEmbed()
                        //.setTitle('TikTok Repost')
                        .addField('Author', message.author.username)
                        .addField('Channel', message.channel.name)
                        .addField('Message', message.cleanContent)
                        .setThumbnail(message.author.avatarURL())
                        //.setTimestamp()
                        .setColor('0x00AAFF');
                        logger.send({ embed });
                }
            }  
        }
        // Cockbot
        if(message.author.id === '184405311681986560') {
            // Increased deletion delay of queue command for readability
            if(message.content.indexOf('with a remaining length of') !== -1) {
                message.delete({ timeout: 40000 })
                .catch(console.error);
            }
            // Increased deletion delay of history command for readability
            else if(message.content.indexOf('Showing tracks in history.') !== -1) {
                message.delete({ timeout: 40000 })
                .catch(console.error);
            }
            // Increased deletion delay of play select command for readability
            else if(message.content.indexOf('Searching YouTube for') !== -1) {
                message.delete({ timeout: 40000 })
                .catch(console.error);
            }
            // Increased deletion delay of error response for readability
            else if(message.content.indexOf('Error occurred when loading') !== -1) {
                message.delete({ timeout: 30000 })
                .catch(console.error);
            }
            else {
                message.delete({ timeout: 30000 })
                .catch(console.error);
            }
        }
        // Groovy Bot
        if(message.author.id === '234395307759108106') {
            // Increased deletion delay of queue command for readability
            if(message.content.indexOf('queue') !== -1) {
                message.delete({ timeout: 40000 })
                .catch(console.error);
            }
            // Increased deletion delay of lyrics command for readability
            else if(message.content.indexOf('Lyrics provided') !== -1) {
                message.delete({ timeout: 50000 })
                .catch(console.error);
            }
            // Increased deletion delay of search response for readability
            else if(message.content.indexOf('track(s)') !== -1) {
                message.delete({ timeout: 40000 })
                .catch(console.error);
            }
            else {
                message.delete({ timeout: 30000 })
                .catch(console.error);
            }
        }
        // TempoBot
        if(message.author.id === '736888501026422855') {
            message.delete({ timeout: 40000 })
            .catch(console.error);
        }
        // RPBot
        if(message.author.id === '204777316621090816') {
            message.delete({ timeout: 10000 })
            .catch(console.error);
        }
        if(message.content.startsWith(';;')) {
            message.delete({ timeout: 5000 })
            .catch(console.error);
        }
        if(message.content.startsWith('-')) {
            message.delete({ timeout: 5000 })
            .catch(console.error);
        }
        if(message.content.startsWith('>')) {
            message.delete({ timeout: 5000 })
            .catch(console.error);
        }
    }

    // Manreet's server
    if(message.channel.id === '466853620336295937') {
        if(message.author.id === '184405311681986560') {
            // Increased deletion delay of queue command for readability
            if(message.content.indexOf('with a remaining length of') !== -1) {
                message.delete({ timeout: 25000 })
                .catch(console.error);
            }
            // Increased deletion delay of history command for readability
            else if(message.content.indexOf('Showing tracks in history.') !== -1) {
                message.delete({ timeout: 30000 })
                .catch(console.error);
            }
            // Increased deletion delay of play select command for readability
            else if(message.content.indexOf('Searching YouTube for') !== -1) {
                message.delete({ timeout: 30000 })
                .catch(console.error);
            }
            else {
                message.delete({ timeout: 15000 })
                .catch(console.error);
            }
        }
        if(message.author.id === '204777316621090816') {
            message.delete({ timeout: 10000 })
            .catch(console.error);
        }
        if(message.content.startsWith(';;')) {
            message.delete({ timeout: 5000 })
            .catch(console.error);
        }
    }
    // Jeff's Server
    if(message.channel.id === '338569847933894656') {
        // Groovy Bot
        if(message.author.id === '234395307759108106') {
            // Increased deletion delay of queue command for readability
            if(message.content.indexOf('queue') !== -1) {
                message.delete({ timeout: 40000 })
                .catch(console.error);
            }
            // Increased deletion delay of lyrics command for readability
            else if(message.content.indexOf('Lyrics provided') !== -1) {
                message.delete({ timeout: 50000 })
                .catch(console.error);
            }
            // Increased deletion delay of search response for readability
            else if(message.content.indexOf('track(s)') !== -1) {
                message.delete({ timeout: 40000 })
                .catch(console.error);
            }
            else {
                message.delete({ timeout: 30000 })
                .catch(console.error);
            }
        }
        if(message.content.startsWith('-')) {
            message.delete({ timeout: 5000 })
            .catch(console.error);
        }
      /*
      if(message.author.id === '133260203759108096') {
            message.channel.send('Shut up Nick, you stupid bitch. My nut is more voluminous and bountiful than yours')
            .catch(console.error);                    
      }*/
    }
    // bigmoist
    if(message.guild.id === '133104742254510080') {
        if(message.content === '>>purge' && message.member.hasPermission('MANAGE_MESSAGES')) {
            message.delete();
            message.channel.messages.fetch().then(messages => {
                const commandMessages = messages.filter(msg => msg.author.bot || msg.content.startsWith(';;') || msg.content.startsWith('>') || msg.content.startsWith('-') || msg.content.startsWith('/'));
                message.channel.bulkDelete(commandMessages);
                          }).catch(err => {
                console.log('Error while doing Bulk Delete.');
                console.log(err);
            });
                /* message.channel.send('Deletion of messages successful. Total messages deleted: '
                                     + messagesDeleted); 
                console.log('Deletion of messages successful. Total messages deleted: ' + messagesDeleted) */
        }
    }
    // Jeff's Server
    if(message.channel.id === '338569847933894656') {
        if(message.content === '>>purge' && message.member.hasPermission('MANAGE_MESSAGES')) {
            message.delete();
            message.channel.messages.fetch().then(messages => {
                const commandMessages = messages.filter(msg => msg.author.bot || msg.content.startsWith(';;') || msg.content.startsWith('>') || msg.content.startsWith('-'));
                message.channel.bulkDelete(commandMessages);
                          }).catch(err => {
                console.log('Error while doing Bulk Delete.');
                console.log(err);
            });
                /* message.channel.send('Deletion of messages successful. Total messages deleted: '
                                     + messagesDeleted); 
                console.log('Deletion of messages successful. Total messages deleted: ' + messagesDeleted) */
        }
    }
    // Manreet's server
    if(message.channel.id === '466853620336295937') {
        if(message.content === '>>purge' && (message.member.hasPermission('MANAGE_MESSAGES') || message.author.id === ('133163729507319809'))) {
            message.delete();
            message.channel.messages.fetch().then(messages => {
                const commandMessages = messages.filter(msg => msg.author.bot || msg.content.startsWith(';;') || msg.content.startsWith('>'));
                message.channel.bulkDelete(commandMessages);
                          }).catch(err => {
                console.log('Error while doing Bulk Delete.');
                console.log(err);
            });
        }
    }
/*      
    if(message.author.bot) return;
    if(message.content.toLowerCase() === '?search') {
        let embed = new Discord.RichEmbed()
            .setColor("#73ffdc")
            .setDescription("Please enter a search query. Remember to narrow down your search.")
            .setTitle("YouTube Search API");
        let embedMsg = await message.channel.send(embed);
        let filter = m => m.author.id === message.author.id;
        let query = await message.channel.awaitMessages(filter, { max: 1 });
        let results = await search(query.first().content, opts).catch(err => console.log(err));
        if(results) {
            let youtubeResults = results.results;
            let i  =0;
            let titles = youtubeResults.map(result => {
                i++;
                return i + ") " + result.title;
            });
            console.log(titles);
            message.channel.send({
                embed: {
                    title: 'Select which song you want by typing the number',
                    description: titles.join("\n")
                }
            }).catch(err => console.log(err));
            
            filter = m => (m.author.id === message.author.id) && m.content >= 1 && m.content <= youtubeResults.length;
            let collected = await message.channel.awaitMessages(filter, { maxMatches: 1 });
            let selected = youtubeResults[collected.first().content - 1];
            embed = new Discord.RichEmbed()
                .setTitle(`${selected.title}`)
                .setURL(`${selected.link}`)
                .setDescription(`${selected.description}`)
                .setThumbnail(`${selected.thumbnails.default.url}`);
            message.channel.send(embed);
        }
    }
    */
})

client.on('messageDelete', message => {
    const CHANNEL = 'log';
    if(message.guild.id === '133104742254510080') {
        if(message.author.id === client.user.id || message.author.bot) return;
        if(message.cleanContent.startsWith('-')) return;
        if(message.cleanContent.startsWith('>')) return;
        //if(message.cleanContent.indexOf('tiktok.com')) return;
        if (message.channel.type === 'text') {
            var logger = message.guild.channels.cache.find(
            channel => channel.id === '567923203880779787'
            );
            if (logger) {
                const embed = new Discord.MessageEmbed()
                    .setTitle('Message Deleted')
                    .addField('Author', message.author.username)
                    .addField('Channel', message.channel.name)
                    .addField('Message', message.cleanContent)
                    .setThumbnail(message.author.avatarURL())
                    //.setTimestamp()
                    .setColor('0x00AAFF');
                    logger.send({ embed });
            }
        }
    }
})






    //Discord bot token 
client.login('');