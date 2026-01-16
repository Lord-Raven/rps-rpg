import {ReactElement} from "react";
import {StageBase, StageResponse, InitialData, Message, User, Character} from "@chub-ai/stages-ts";
import {LoadResponse} from "@chub-ai/stages-ts/dist/types/load";
import { Client } from "@gradio/client";


enum Play {
    ROCK = 'rock',
    PAPER = 'paper',
    SCISSORS = 'scissors'
}

type MessageStateType = {
    wins: number;
    losses: number;
    ties: number;
    userPlayed: Play|undefined;
    otherPlayed: Play|undefined;
};


type ConfigType = any;


type InitStateType = any;


type ChatStateType = any;


export class Stage extends StageBase<InitStateType, ChatStateType, MessageStateType, ConfigType> {

    currentState: MessageStateType;
    client: any;
    users: {[key: string]: User} = {};
    characters: {[key: string]: Character} = {};


    constructor(data: InitialData<InitStateType, ChatStateType, MessageStateType, ConfigType>) {

        super(data);
        const {
            users,
            characters,
            messageState,
        } = data;

        this.users = users;
        this.characters = characters;
        this.currentState = messageState as MessageStateType;
    }

    async load(): Promise<Partial<LoadResponse<InitStateType, ChatStateType, MessageStateType>>> {

        try {
            this.client = await Client.connect("Ravenok/statosphere-backend");
        } catch (error) {
            console.error(`Error connecting to backend.`);
        }

        console.log('Finished loading stage.');

        return {
            success: true,
            error: null,
            initState: null,
            chatState: null,
        };
    }

    async setState(state: MessageStateType): Promise<void> {
        if (state != null) {
            this.currentState = {...state};
        }
    }

    async beforePrompt(userMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {
        
        const {
            content,
            anonymizedId,
            promptForId
        } = userMessage;

        this.currentState.userPlayed = undefined;
        this.currentState.otherPlayed = undefined;

        let finalContent: string|undefined = content;
        if (finalContent) {
            let sequence = this.replaceTags(content, {"user": anonymizedId ? this.users[anonymizedId].name : '', "char": promptForId ? this.characters[promptForId].name : ''});

            const playMapping:{[key: string]: Play|undefined} = {
                'rock': Play.ROCK,
                'paper': Play.PAPER,
                'scissors': Play.SCISSORS,
                'nothing': undefined};
            const playHypothesis = '{{user}} is playing {}.';
            let playResponse = await this.query({sequence: sequence, candidate_labels: Object.keys(playMapping), hypothesis_template: playHypothesis, multi_label: true });
            if (playResponse && playResponse.labels && playResponse.labels.length && playResponse.labels[0]) {
                console.log(`Play detected: ${playMapping[playResponse.labels[0]]}`);
                this.currentState.userPlayed = playMapping[playResponse.labels[0]];
            }
        }

        let stageDirections = 'This universe is secretly and tacitly ruled by the will of rock-paper-scissors.';

        if (this.currentState.userPlayed) {
            // User picked something, pick an otherPlayed;
            this.currentState.otherPlayed = Object.values(Play)[Math.floor(Math.random() * Object.values(Play).length)];

            if (this.currentState.otherPlayed === this.currentState.userPlayed) {
                stageDirections = `${stageDirections} {{user}} has invoked the universe's will by throwing ${this.currentState.userPlayed}. ` +
                    `Depict an opposing party that will now throw ${this.currentState.otherPlayed}, resulting in a tie. As a result, the universe will simply abide.`;
                this.currentState.ties += 1;
            } else if (
                (this.currentState.userPlayed === Play.ROCK && this.currentState.otherPlayed === Play.SCISSORS) ||
                (this.currentState.userPlayed === Play.PAPER && this.currentState.otherPlayed === Play.ROCK) ||
                (this.currentState.userPlayed === Play.SCISSORS && this.currentState.otherPlayed === Play.PAPER)
            ) {
                stageDirections = `${stageDirections} {{user}} has invoked the universe's will by throwing ${this.currentState.userPlayed}. ` +
                    `Depict an opposing party that will now throw ${this.currentState.otherPlayed}, resulting in {{user}}'s unilateral victory; the universe will bend to achieve {{user}}'s current objective or intent, no matter how ridiculous.`;
                this.currentState.wins += 1;
            } else {
                stageDirections = `${stageDirections} {{user}} has invoked the universe's will by throwing ${this.currentState.userPlayed}. ` +
                    `Depict an opposing party that will now throw ${this.currentState.otherPlayed}, resulting in {{user}}'s unilateral defeat; the universe will subvert the will {{user}}'s current objective or intent in ridiculous fashion.`;
                this.currentState.losses += 1;
            }
        } else {
            stageDirections = `${stageDirections} But no one is playing rock-paper-scissors in this moment.`;
        }

        const systemMessage = (this.currentState.wins + this.currentState.losses + this.currentState.ties > 0) ? `---\n{{user}}'s record: ${this.currentState.wins}-${this.currentState.losses}-${this.currentState.ties}.` : null;

        return {
            stageDirections: stageDirections,
            messageState: {...this.currentState},
            modifiedMessage: null,
            systemMessage: systemMessage,
            error: null,
            chatState: null,
        };
    }

    async afterResponse(botMessage: Message): Promise<Partial<StageResponse<ChatStateType, MessageStateType>>> {

        const {
            content,
        } = botMessage;

        // If content contains "System:" or "---" trim to that point.
        let finalContent: string|undefined = content;
        if (finalContent) {
            const systemIndex = finalContent.indexOf('System:');
            const separatorIndex = finalContent.indexOf('---');
            let trimIndex = -1;
            if (systemIndex !== -1 && (separatorIndex === -1 || systemIndex < separatorIndex)) {
                trimIndex = systemIndex;
            } else if (separatorIndex !== -1) {
                trimIndex = separatorIndex;
            }
            if (trimIndex !== -1) {
                finalContent = finalContent.substring(0, trimIndex).trim();
            }
        }

        return {
            stageDirections: null,
            messageState: {...this.currentState},
            modifiedMessage: finalContent,
            error: null,
            systemMessage: null,
            chatState: null
        };
    }

    replaceTags(source: string, replacements: {[name: string]: string}) {
        return source.replace(/{{([A-z|\d]*)}}/g, (match) => {
            return replacements[match.substring(2, match.length - 2)];
        });
    }

    async query(data: any) {
        let result: any = null;
        if (this.client) {
            try {
                const response = await this.client.predict("/predict", {data_string: JSON.stringify(data)});
                result = JSON.parse(`${response.data[0]}`);
            } catch(e) {
                console.log(e);
            }
        }
        if (result) {
            console.log({sequence: data.sequence, hypothesisTemplate: data.hypothesis_template, labels: result.labels, scores: result.scores});
        } else {
            console.warn('Disconnected from Hugging Face.');
        }
        return result;
    }

    render(): ReactElement {
        return <></>;
    }

}
