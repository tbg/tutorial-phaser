/**
 * ---------------------------
 * Phaser + Colyseus - Part 4.
 * ---------------------------
 * - Connecting with the room
 * - Sending inputs at the user's framerate
 * - Update other player's positions WITH interpolation (for other players)
 * - Client-predicted input for local (current) player
 * - Fixed tickrate on both client and server
 */

import Phaser from "phaser";
import { Room, Client, getStateCallbacks } from "colyseus.js";
import { BACKEND_URL } from "../backend";

// Import the state type from server-side code
import type { MyRoomState } from "../../../server/src/rooms/Part4Room";

export class Part4Scene extends Phaser.Scene {
    room: Room<MyRoomState>;

    currentPlayer: Phaser.Types.Physics.Arcade.ImageWithDynamicBody;
    playerEntities: { [sessionId: string]: Phaser.Types.Physics.Arcade.ImageWithDynamicBody } = {};

    debugFPS: Phaser.GameObjects.Text;

    localRef: Phaser.GameObjects.Rectangle;
    remoteRef: Phaser.GameObjects.Rectangle;

    cursorKeys: Phaser.Types.Input.Keyboard.CursorKeys;
    actionKey: Phaser.Input.Keyboard.Key;

    boxes: Phaser.Physics.Arcade.Group;
    leftBoxes: Phaser.Physics.Arcade.Image[] = [];
    rightBoxes: Phaser.Physics.Arcade.Image[] = [];
    circles: Phaser.Physics.Arcade.Group;
    
    // Game mechanics
    circleTimer: Phaser.Time.TimerEvent;
    score: number = 0;
    scoreText: Phaser.GameObjects.Text;
    carriedCircle: Phaser.GameObjects.Arc = null;
    goalBox: Phaser.GameObjects.Rectangle = null;
    goalBoxText: Phaser.GameObjects.Text = null;
    gameOver: boolean = false;
    gameOverText: Phaser.GameObjects.Text = null;
    alphabetRanges = [
        { range: 'A-E', letters: 'ABCDE' },
        { range: 'F-I', letters: 'FGHI' },
        { range: 'J-M', letters: 'JKLM' },
        { range: 'N-Q', letters: 'NOPQ' },
        { range: 'R-U', letters: 'RSTU' },
        { range: 'V-Z', letters: 'VWXYZ' }
    ];

    inputPayload = {
        left: false,
        right: false,
        up: false,
        down: false,
        tick: undefined,
    };

    elapsedTime = 0;
    fixedTimeStep = 1000 / 60;

    currentTick: number = 0;

    constructor() {
        super({ key: "part4" });
    }

    preload() {
        this.load.image('ship_0001', 'assets/ship_0001.png');
        this.load.image('box', 'assets/box.png');
        
        // Create a simple cockroach sprite programmatically
        this.createCockroachSprite();
    }

    createCockroachSprite() {
        // Create a simple cockroach-like sprite using graphics
        const graphics = this.add.graphics();
        
        // Body (brown oval)
        graphics.fillStyle(0x8B4513); // Brown color
        graphics.fillEllipse(16, 16, 20, 12);
        
        // Head (darker brown circle)
        graphics.fillStyle(0x654321);
        graphics.fillCircle(16, 8, 6);
        
        // Antennae (black lines)
        graphics.lineStyle(1, 0x000000);
        graphics.beginPath();
        graphics.moveTo(14, 6);
        graphics.lineTo(12, 2);
        graphics.moveTo(18, 6);
        graphics.lineTo(20, 2);
        graphics.strokePath();
        
        // Legs (small black lines)
        graphics.lineStyle(1, 0x000000);
        graphics.beginPath();
        // Left legs
        graphics.moveTo(8, 14);
        graphics.lineTo(4, 18);
        graphics.moveTo(8, 18);
        graphics.lineTo(4, 22);
        graphics.moveTo(8, 22);
        graphics.lineTo(4, 26);
        // Right legs
        graphics.moveTo(24, 14);
        graphics.lineTo(28, 18);
        graphics.moveTo(24, 18);
        graphics.lineTo(28, 22);
        graphics.moveTo(24, 22);
        graphics.lineTo(28, 26);
        graphics.strokePath();
        
        // Convert graphics to texture
        graphics.generateTexture('cockroach', 32, 32);
        graphics.destroy();
    }

    async create() {
        this.cursorKeys = this.input.keyboard.createCursorKeys();
        this.actionKey = this.input.keyboard.addKey('P');
        this.debugFPS = this.add.text(4, 4, "", { color: "#ff0000", });

        // Initialize game systems
        this.boxes = this.physics.add.group();
        this.circles = this.physics.add.group();
        
        // Create score display
        this.scoreText = this.add.text(16, 50, 'Score: 0', {
            fontSize: '24px',
            color: '#000000',
            fontFamily: 'Arial, sans-serif',
            fontStyle: 'bold'
        });
        
        // Add instructions
        this.add.text(16, 80, 'Instructions: Control the cockroach! Catch red circles before they reach boxes (P)! Sort to correct alphabet box (circle turns green while you hold it), then carry to goal box for points!', {
            fontSize: '14px',
            color: '#333333',
            fontFamily: 'Arial, sans-serif',
            wordWrap: { width: 600 }
        });

        const canvasWidth = Number(this.sys.game.config.width);
        const canvasHeight = Number(this.sys.game.config.height);
        const boxWidth = 200;
        const boxHeight = 100;
        const padding = 20;

        // Define alphabet ranges for each box
        const alphabetRanges = ['A-E', 'F-I', 'J-M', 'N-Q', 'R-U', 'V-Z'];

        // Create the 6 right boxes with alphabet ranges
        for (let i = 0; i < 6; i++) {
            const boxX = canvasWidth - boxWidth / 2;
            const boxY = 100 + (i * (boxHeight + padding));
            
            const box = this.boxes.create(boxX, boxY, 'box');
            box.setData('id', i);
            box.setData('type', 'right');
            box.setData('alphabetIndex', i);
            box.body.immovable = true;
            box.displayWidth = boxWidth;
            box.displayHeight = boxHeight;
            
            // Store in rightBoxes array
            this.rightBoxes.push(box);
            
            // Add alphabet range text to each box
            const rangeText = this.add.text(boxX, boxY, this.alphabetRanges[i].range, {
                fontSize: '24px',
                color: '#ffffff',
                fontFamily: 'Arial, sans-serif',
                fontStyle: 'bold',
                stroke: '#000000',
                strokeThickness: 2
            });
            rangeText.setOrigin(0.5, 0.5); // Center the text
            
            // Add a subtle background for better readability
            const textBg = this.add.rectangle(boxX, boxY, rangeText.width + 20, rangeText.height + 10, 0x000000, 0.6);
            textBg.setOrigin(0.5, 0.5);
            
            // Ensure text appears above background
            textBg.setDepth(1);
            rangeText.setDepth(2);
        }

        const newBoxHeight = canvasHeight * 0.4;
        const verticalSpacing = (canvasHeight - (2 * newBoxHeight)) / 3;

        // Create the 2 left boxes
        const box1 = this.boxes.create(boxWidth / 2, verticalSpacing + newBoxHeight / 2, 'box');
        box1.setData('id', 6);
        box1.setData('type', 'left');
        box1.body.immovable = true;
        box1.displayWidth = boxWidth;
        box1.displayHeight = newBoxHeight;
        this.leftBoxes.push(box1);

        const box2 = this.boxes.create(boxWidth / 2, (verticalSpacing * 2) + newBoxHeight + (newBoxHeight / 2), 'box');
        box2.setData('id', 7);
        box2.setData('type', 'left');
        box2.body.immovable = true;
        box2.displayWidth = boxWidth;
        box2.displayHeight = newBoxHeight;
        this.leftBoxes.push(box2);
        
        // Start the circle generation timer
        this.startCircleTimer();

        // connect with the room
        await this.connect();

        const $ = getStateCallbacks(this.room);

        $(this.room.state).players.onAdd((player, sessionId) => {
            const entity = this.physics.add.image(player.x, player.y, 'cockroach');
            this.playerEntities[sessionId] = entity;

            // is current player
            if (sessionId === this.room.sessionId) {
                this.currentPlayer = entity;

                this.localRef = this.add.rectangle(0, 0, entity.width, entity.height);
                this.localRef.setStrokeStyle(1, 0x00ff00);

                this.remoteRef = this.add.rectangle(0, 0, entity.width, entity.height);
                this.remoteRef.setStrokeStyle(1, 0xff0000);

                $(player).onChange(() => {
                    this.remoteRef.x = player.x;
                    this.remoteRef.y = player.y;
                });

            } else {
                // listening for server updates
                $(player).onChange(() => {
                    //
                    // we're going to LERP the positions during the render loop.
                    //
                    entity.setData('serverX', player.x);
                    entity.setData('serverY', player.y);
                });

            }

        });

        // remove local reference when entity is removed from the server
        $(this.room.state).players.onRemove((player, sessionId) => {
            const entity = this.playerEntities[sessionId];
            if (entity) {
                entity.destroy();
                delete this.playerEntities[sessionId]
            }
        });

        // this.cameras.main.startFollow(this.ship, true, 0.2, 0.2);
        // this.cameras.main.setZoom(1);
        this.cameras.main.setBounds(0, 0, 1440, 800);
    }

    async connect() {
        // add connection status text
        const connectionStatusText = this.add
            .text(0, 0, "Trying to connect with the server...")
            .setStyle({ color: "#ff0000" })
            .setPadding(4)

        const client = new Client(BACKEND_URL);

        try {
            //
            // It's important to send `headers` on matchmaking request,
            // so we can identify the client on the server-side.
            //
            this.room = await client.joinOrCreate("part4_room", {
                headers: {
                    'ngrok-skip-browser-warning': 'true',
                }
            });

            // connection successful!
            connectionStatusText.destroy();

        } catch (e) {
            // couldn't connect
            connectionStatusText.text = "Could not connect with the server.";
        }

    }

    update(time: number, delta: number): void {
        // skip loop if not connected yet or game over
        if (!this.currentPlayer || this.gameOver) { return; }

        // Handle box interactions
        this.physics.world.overlap(this.currentPlayer, this.boxes, (player, box) => {
            if (this.actionKey.isDown && !this.gameOver) {
                const boxData = box as Phaser.Physics.Arcade.Image;
                
                // If carrying a circle, try to drop it
                if (this.carriedCircle) {
                    if (boxData.getData('type') === 'right') {
                        this.dropCircle(boxData);
                    }
                }
            }
        });

        // Handle goal box interaction
        if (this.goalBox && this.carriedCircle && this.actionKey.isDown && !this.gameOver) {
            const distance = Phaser.Math.Distance.Between(
                this.currentPlayer.x, this.currentPlayer.y,
                this.goalBox.x, this.goalBox.y
            );
            
            if (distance < 80 && this.carriedCircle.getData('state') === 'correct_box') {
                // Successfully returned green circle to goal box
                this.returnCircleToGoalBox();
            }
        }

        // Handle circle pickup (intercept traveling circles or pick up green circles)
        this.physics.world.overlap(this.currentPlayer, this.circles, (player, circle) => {
            const circleData = circle as Phaser.GameObjects.Arc;
            const circleState = circleData.getData('state');
            if (this.actionKey.isDown && 
                (circleState === 'traveling' || circleState === 'correct_box') && 
                !this.carriedCircle && 
                !this.gameOver) {
                this.pickupCircle(circleData);
            }
        });

        // Update carried circle position to follow player
        if (this.carriedCircle && this.carriedCircle.getData('isCarried')) {
            this.carriedCircle.x = this.currentPlayer.x;
            this.carriedCircle.y = this.currentPlayer.y - 30; // Slightly above player
            const letterText = this.carriedCircle.getData('letterText');
            if (letterText) {
                letterText.x = this.carriedCircle.x;
                letterText.y = this.carriedCircle.y;
            }
        }

        this.elapsedTime += delta;
        while (this.elapsedTime >= this.fixedTimeStep) {
            this.elapsedTime -= this.fixedTimeStep;
            this.fixedTick(time, this.fixedTimeStep);
        }

        this.debugFPS.text = `Frame rate: ${this.game.loop.actualFps}`;
    }

    fixedTick(time, delta) {
        this.currentTick++;

        // const currentPlayerRemote = this.room.state.players.get(this.room.sessionId);
        // const ticksBehind = this.currentTick - currentPlayerRemote.tick;
        // console.log({ ticksBehind });

        const velocity = 10;
        this.inputPayload.left = this.cursorKeys.left.isDown;
        this.inputPayload.right = this.cursorKeys.right.isDown;
        this.inputPayload.up = this.cursorKeys.up.isDown;
        this.inputPayload.down = this.cursorKeys.down.isDown;
        this.inputPayload.tick = this.currentTick;
        this.room.send(0, this.inputPayload);

        if (this.inputPayload.left) {
            this.currentPlayer.x -= velocity;

        } else if (this.inputPayload.right) {
            this.currentPlayer.x += velocity;
        }

        if (this.inputPayload.up) {
            this.currentPlayer.y -= velocity;

        } else if (this.inputPayload.down) {
            this.currentPlayer.y += velocity;
        }

        this.localRef.x = this.currentPlayer.x;
        this.localRef.y = this.currentPlayer.y;

        for (let sessionId in this.playerEntities) {
            // interpolate all player entities
            // (except the current player)
            if (sessionId === this.room.sessionId) {
                continue;
            }

            const entity = this.playerEntities[sessionId];
            const { serverX, serverY } = entity.data.values;

            entity.x = Phaser.Math.Linear(entity.x, serverX, 0.2);
            entity.y = Phaser.Math.Linear(entity.y, serverY, 0.2);
        }

    }

    startCircleTimer() {
        // Generate the first circle immediately
        this.generateCircle();
        // Then start the timer for subsequent circles
        this.circleTimer = this.time.addEvent({
            delay: 10000, // 10 seconds
            callback: this.generateCircle,
            callbackScope: this,
            loop: true
        });
    }

    generateCircle() {
        // Don't generate circles if game is over
        if (this.gameOver) return;
        
        // Pick a random left box
        const randomLeftBox = Phaser.Utils.Array.GetRandom(this.leftBoxes);
        
        // Pick a random right box as destination
        const randomRightBox = Phaser.Utils.Array.GetRandom(this.rightBoxes);
        
        // Generate a random alphabet character
        const allLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const randomLetter = Phaser.Utils.Array.GetRandom(allLetters.split(''));
        
        // Create a red circle
        const circle = this.add.circle(randomLeftBox.x, randomLeftBox.y, 20, 0xff0000);
        circle.setStrokeStyle(2, 0x000000);
        
        // Add physics to the circle
        this.physics.add.existing(circle);
        this.circles.add(circle);
        
        // Store circle data
        circle.setData('letter', randomLetter);
        circle.setData('originalDestination', randomRightBox);
        circle.setData('state', 'traveling'); // traveling, picked_up, correct_box, returning
        circle.setData('isCarried', false);
        
        // Add the letter text on the circle
        const letterText = this.add.text(circle.x, circle.y, randomLetter, {
            fontSize: '16px',
            color: '#ffffff',
            fontFamily: 'Arial, sans-serif',
            fontStyle: 'bold'
        });
        letterText.setOrigin(0.5, 0.5);
        circle.setData('letterText', letterText);
        
        // Animate circle to destination (slower speed for player to catch)
        this.tweens.add({
            targets: [circle, letterText],
            x: randomRightBox.x,
            y: randomRightBox.y,
            duration: 6000, // Slower: 6 seconds instead of 2
            ease: 'Linear',
            onComplete: () => {
                // Game over if circle reaches destination without being caught
                if (!circle.getData('isCarried')) {
                    this.triggerGameOver();
                } else {
                    circle.setData('state', 'waiting_pickup');
                }
            }
        });
    }

    getCorrectBoxForLetter(letter: string): number {
        for (let i = 0; i < this.alphabetRanges.length; i++) {
            if (this.alphabetRanges[i].letters.includes(letter)) {
                return i;
            }
        }
        return -1;
    }

    pickupCircle(circle: Phaser.GameObjects.Arc) {
        if (this.carriedCircle || circle.getData('isCarried') || this.gameOver) return;
        
        this.carriedCircle = circle as any;
        circle.setData('isCarried', true);
        circle.setData('state', 'picked_up');
        
        // Change appearance to show it's being carried
        circle.setAlpha(0.7);
        
        // Create goal box when player picks up circle
        this.createGoalBox();
    }

    dropCircle(targetBox: Phaser.Physics.Arcade.Image) {
        if (!this.carriedCircle || this.gameOver) return;
        
        const circle = this.carriedCircle;
        const letter = circle.getData('letter');
        const correctBoxIndex = this.getCorrectBoxForLetter(letter);
        const targetBoxIndex = targetBox.getData('alphabetIndex');
        
        if (targetBox.getData('type') === 'right') {
            if (targetBoxIndex === correctBoxIndex) {
                // Stop the original tween to prevent game over
                this.tweens.killTweensOf([circle, circle.getData('letterText')]);
                
                // Correct box! Keep the circle carried but turn it green
                circle.setData('state', 'correct_box');
                circle.setFillStyle(0x00ff00);
                circle.setAlpha(1);
                
                // Keep the circle being carried (don't clear carriedCircle)
                // The circle stays with the player and continues following them
                // The circle remains in 'isCarried' state
            } else {
                // Wrong box, return to player
                this.returnCircleToPlayer();
            }
        }
    }



    returnCircleToPlayer() {
        if (!this.carriedCircle) return;
        
        const circle = this.carriedCircle;
        circle.setAlpha(1);
        this.carriedCircle = null;
        circle.setData('isCarried', false);
        circle.setData('state', 'waiting_pickup');
    }

    triggerGameOver() {
        if (this.gameOver) return;
        
        this.gameOver = true;
        
        // Stop circle generation
        if (this.circleTimer) {
            this.circleTimer.destroy();
            this.circleTimer = null;
        }
        
        // Clear any carried circle
        this.carriedCircle = null;
        
        // Remove goal box if it exists
        if (this.goalBox) {
            this.goalBox.destroy();
            this.goalBox = null;
        }
        if (this.goalBoxText) {
            this.goalBoxText.destroy();
            this.goalBoxText = null;
        }
        
        // Display game over message
        const centerX = Number(this.sys.game.config.width) / 2;
        const centerY = Number(this.sys.game.config.height) / 2;
        
        const gameOverBg = this.add.rectangle(centerX, centerY, 600, 200, 0x000000, 0.8);
        
        this.gameOverText = this.add.text(centerX, centerY - 20, 'GAME OVER!', {
            fontSize: '48px',
            color: '#ff0000',
            fontFamily: 'Arial, sans-serif',
            fontStyle: 'bold'
        });
        this.gameOverText.setOrigin(0.5, 0.5);
        
        const restartText = this.add.text(centerX, centerY + 30, 'A circle reached a box! Press R to restart', {
            fontSize: '20px',
            color: '#ffffff',
            fontFamily: 'Arial, sans-serif'
        });
        restartText.setOrigin(0.5, 0.5);
        
        // Add restart functionality - use once() instead of on() to avoid multiple listeners
        this.input.keyboard.once('keydown-R', () => {
            this.restartGame();
        });
    }

    restartGame() {
        // Clean up everything before restarting
        this.gameOver = false;
        this.score = 0;
        this.carriedCircle = null;
        
        // Remove all circles and their text
        this.circles.children.entries.forEach((circle: any) => {
            const letterText = circle.getData('letterText');
            if (letterText) {
                letterText.destroy();
            }
            circle.destroy();
        });
        this.circles.clear();
        
        // Clean up timers
        if (this.circleTimer) {
            this.circleTimer.destroy();
            this.circleTimer = null;
        }
        
        // Remove goal box
        if (this.goalBox) {
            this.goalBox.destroy();
            this.goalBox = null;
        }
        if (this.goalBoxText) {
            this.goalBoxText.destroy();
            this.goalBoxText = null;
        }
        
        // Restart the scene
        this.scene.restart();
    }

    createGoalBox() {
        if (this.goalBox || this.gameOver) return;
        // Get game bounds
        const width = Number(this.sys.game.config.width);
        const height = Number(this.sys.game.config.height);
        // Random position, but keep the box fully on screen
        const boxWidth = 120;
        const boxHeight = 80;
        const margin = 20;
        const minX = margin + boxWidth / 2;
        const maxX = width - margin - boxWidth / 2;
        const minY = margin + boxHeight / 2;
        const maxY = height - margin - boxHeight / 2;
        const randomX = Phaser.Math.Between(minX, maxX);
        const randomY = Phaser.Math.Between(minY, maxY);
        this.goalBox = this.add.rectangle(randomX, randomY, boxWidth, boxHeight, 0xffff00, 0.8);
        this.goalBox.setStrokeStyle(3, 0xff8800);
        this.goalBoxText = this.add.text(randomX, randomY, 'GOAL\nBOX', {
            fontSize: '16px',
            color: '#000000',
            fontFamily: 'Arial, sans-serif',
            fontStyle: 'bold',
            align: 'center'
        });
        this.goalBoxText.setOrigin(0.5, 0.5);
    }

    returnCircleToGoalBox() {
        if (!this.carriedCircle || !this.goalBox || this.gameOver) return;
        
        const circle = this.carriedCircle;
        const letterText = circle.getData('letterText');
        
        // Award point and clean up
        this.score += 1;
        this.scoreText.setText(`Score: ${this.score}`);
        
        // Remove circle and text
        letterText.destroy();
        circle.destroy();
        this.circles.remove(circle);
        
        // Remove goal box
        this.goalBox.destroy();
        this.goalBoxText.destroy();
        this.goalBox = null;
        this.goalBoxText = null;
        
        // Clear carried circle
        this.carriedCircle = null;
    }

}