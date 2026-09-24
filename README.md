# owlEyes
A chrome/firefox extension based off of shinigami-eyes that allows for local and gist pulled lists of tags of users and websites.

One of the first actual projects I'll be attempting to make. Don't expect fully quality code.

Based on and directly inspired mostly by: [Shinigami Eyes website](https://shinigami-eyes.github.io/)

I personally didn't do alot of the coding. I kinda just asked a friend to help me push out an idea I had been sitting on for months, gave him my scrappings of code I tried to rewrite from the original shinigami eyes, and said "have fun, i will be your personal debugging jockey". 7 hours later, we're here now I guess.

Wanna change something? Feel free to, I'll merge pull requests that add features, deny em, so on so forth. I just wanted this for myself and some friends, and I'm glad to try and share it with the world.

Do I plan on editing or updating this? Probably never. It's a local first tool, so unless something crazy breaks. Nah.

# installation.

1. download the repository by clicking the green code button, download as zip
2. extract that zip somewhere where you'll find it again.
3. navigate to your browsers extensions menu. enable developer mode.
4. click load unpacked. point it torwards the folder of the now unpacked extension

done : )

# Usage

you can use the extension one of two ways

1. setting it up yourself

upon installation you can go to the extensions settings, and create your own labels
from there you can right click display names on twitter or bluesky (or take their profile links)

2. drop in n subscribe

after installing, you can simply subscribe to a friend or curators gist and automatically pull in an entire databse

# Additional Setup

1. provide a **Fine Grained** GitHub Token (with gist read/write permissions) and click save
2. Add an name (this is purely visual!) , the link to your gist (secret gists work too!) and whatever you want your database file to actually be called
3. Select all labels you want to be added to this specific upload/gist link
4. done !

every time you add label anything that corresponds to said upload will automatically get pushed to your gist now!

you can *also* (RESPONSIBLY) share token credentials and this setup with others to create a community upload!
upon synchronization (upward or downward) *only* merges, and respects your local changes first

downward syncs can be ignored via the aptly named ignore button

# personal biz.

theres not many things i can think of that id love to see implemented, but also im not gonna beg the internet for free code, cause who am i? but, being a furry, theres probably better people out there who are REALLY good at this sorta stuff. im just an ideas guy, i cant claim to call the shots.

## also? weird psuedo disclaimer

i didnt personally vet the code, i do kinda know the person who coded this somewhat dabbles in dealing with alot of AI stuff, though i did personally ask that they dont vibecode this entire thing for me, and try to just slap it all together, i didnt want it to be perfect anyways.
