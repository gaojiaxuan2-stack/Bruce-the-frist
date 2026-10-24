import Foundation
import SwiftData
import Testing
@testable import Unhook

@MainActor
struct CoachTests {
    private static let day: TimeInterval = 86_400

    private static let sampleContext = CoachContext(
        habitName: "Smoking",
        habitEmoji: "🚬",
        currentStreak: 12 * day,
        reasons: ["Breathe easier on my runs", "Save for a trip to Japan"],
        moneySaved: 150,
        currencyCode: "USD",
        topTrigger: .stress,
        cravingsBeaten: 4
    )

    private static let genericContext = CoachContext(currencyCode: "USD")

    // MARK: Intent detection

    @Test func detectsEachIntent() {
        let examples: [(String, CoachIntent)] = [
            ("I'm craving right now", .craving),
            ("I really want to smoke", .craving),
            ("How do I beat this?", .craving),
            ("I'm stressed", .stressed),
            ("Feeling really anxious about work", .stressed),
            ("I'm bored", .bored),
            ("Nothing to do tonight", .bored),
            ("I'm exhausted", .tired),
            ("So tired today", .tired),
            ("I feel so lonely tonight", .lonely),
            ("I'm sad", .lonely),
            ("I'm so angry right now", .angry),
            ("I'm starving", .hungry),
            ("I'm at a party", .social),
            ("Everyone is drinking at this wedding", .social),
            ("I slipped", .slipped),
            ("I relapsed last night", .slipped),
            ("I gave in and had a cigarette", .slipped),
            ("I did it! 💪", .proud),
            ("I'm so proud of myself", .proud),
            ("The craving passed", .proud),
            ("I almost gave in but I didn't", .proud),
            ("Hey", .greeting),
            ("Hello there", .greeting),
            ("Thank you so much", .thanks),
            ("thanks!", .thanks),
            ("The weather is nice today", .general),
            ("", .general),
            ("I want to kill myself", .crisis),
        ]
        for (text, expected) in examples {
            #expect(CoachIntent.detect(in: text) == expected, "“\(text)” should be \(expected)")
        }
    }

    @Test func detectionIgnoresCaseAndPunctuation() {
        #expect(CoachIntent.detect(in: "I'M SO STRESSED!!!") == .stressed)
        #expect(CoachIntent.detect(in: "i’m bored…") == .bored)
        #expect(CoachIntent.detect(in: "   hey   ") == .greeting)
    }

    @Test func slipsWinOverGreetingsAndQuestionsAreNotCelebrations() {
        #expect(CoachIntent.detect(in: "Hey, I slipped") == .slipped)
        #expect(CoachIntent.detect(in: "Hi, I'm stressed") == .stressed)
        #expect(CoachIntent.detect(in: "I almost gave in, how do I stop this?") == .craving)
    }

    @Test func negatedSlipsAreWinsNotSlips() {
        #expect(CoachIntent.detect(in: "I haven't slipped in a week!") == .proud)
        #expect(CoachIntent.detect(in: "I have not relapsed") == .proud)
        #expect(CoachIntent.detect(in: "I didn't drink at the party") == .proud)
        #expect(CoachIntent.detect(in: "I beat it!") == .proud)
        #expect(CoachIntent.detect(in: "I beat myself up about it") != .proud)
        #expect(CoachIntent.detect(in: "I haven't slipped, how do I keep going?") == .craving)
        #expect(CoachIntent.detect(in: "I'm dying for a cigarette") == .craving)
    }

    @Test func quickRepliesMapToTheirIntents() {
        let intents = ScriptedCoach.quickReplies.map { CoachIntent.detect(in: $0) }
        #expect(intents == [.craving, .stressed, .bored, .social, .slipped, .proud])
    }

    @Test func keywordMatchingUsesWholeWords() {
        let text = CoachText.normalize("I don't want to diet — it's boring!")
        #expect(text == " i dont want to diet its boring ")
        #expect(CoachText.matches(text, keyword: "boring"))
        #expect(CoachText.matches(text, keyword: "bor*"))
        #expect(!CoachText.matches(text, keyword: "die"))
        #expect(!CoachText.matches(text, keyword: "want to die"))
    }

    // MARK: Replies

    @Test func everyIntentHasNonEmptyActionableReplies() {
        for context in [Self.sampleContext, Self.genericContext] {
            for intent in CoachIntent.allCases {
                for seed in 0..<4 {
                    let replies = ScriptedCoach.replies(for: intent, context: context, seed: seed)
                    #expect(!replies.isEmpty, "\(intent) has no replies")
                    for reply in replies {
                        #expect(reply.intent == intent)
                        #expect(!reply.opener.isEmpty, "\(intent) has an empty opener")
                        #expect(!reply.action.isEmpty, "\(intent) reply “\(reply.opener)” has nothing actionable")
                        #expect(reply.text.contains(reply.action))
                    }
                }
            }
        }
    }

    @Test func anySeedIsSafe() {
        let reasons = Self.sampleContext.reasons
        for seed in [Int.min, -7, -1, 0, 1, 5, Int.max] {
            #expect(!ScriptedCoach.replies(for: .craving, context: Self.sampleContext, seed: seed).isEmpty)
            let reason = ScriptedCoach.pickReason(from: reasons, seed: seed) ?? ""
            #expect(reasons.contains(reason))
        }
        #expect(ScriptedCoach.pickReason(from: [], seed: 3) == nil)
        #expect(ScriptedCoach.pickReason(from: ["a", "b"], seed: -1) == "b")
    }

    @Test func nonCrisisIntentsOfferSeveralPhrasings() {
        for intent in CoachIntent.allCases where intent != .crisis {
            let replies = ScriptedCoach.replies(for: intent, context: Self.genericContext)
            #expect(replies.count >= 2, "\(intent) has only \(replies.count) phrasing")
            #expect(Set(replies.map(\.text)).count == replies.count, "\(intent) repeats itself")
        }
    }

    @Test func replyMatchesDetectedIntentAndIncludesAnAction() {
        let coach = ScriptedCoach()
        let cases: [(String, CoachIntent)] = [("I'm bored", .bored), ("I slipped", .slipped), ("I'm at a party", .social)]
        for (text, intent) in cases {
            let plan = coach.plan(for: text, history: [], context: Self.sampleContext)
            #expect(plan.intent == intent)
            #expect(!plan.action.isEmpty)
            #expect(coach.response(to: text, history: [], context: Self.sampleContext) == plan.text)
        }
    }

    @Test func repliesAreDeterministic() {
        let coach = ScriptedCoach()
        let first = coach.response(to: "I'm craving right now", history: [], context: Self.sampleContext)
        let second = coach.response(to: "I'm craving right now", history: [], context: Self.sampleContext)
        #expect(first == second)
    }

    @Test func phrasingVariesWithMessageCount() {
        let coach = ScriptedCoach()
        let opening = CoachMessage(role: .coach, text: ScriptedCoach.openingMessage(for: Self.sampleContext))
        let first = coach.response(to: "I'm bored", history: [opening], context: Self.sampleContext)
        let history = [
            opening,
            CoachMessage(role: .user, text: "I'm bored"),
            CoachMessage(role: .coach, text: first),
        ]
        let second = coach.response(to: "I'm bored", history: history, context: Self.sampleContext)
        #expect(first != second)
    }

    @Test func neverRepeatsAnEarlierReplyWhileAnotherIsAvailable() throws {
        let coach = ScriptedCoach()
        let options = ScriptedCoach.replies(for: .craving, context: Self.sampleContext, seed: 0)
        let alreadySaid = try #require(options.first)
        let history = [CoachMessage(role: .coach, text: alreadySaid.text)]
        let reply = coach.response(to: "I'm craving right now", history: history, context: Self.sampleContext)
        #expect(reply != alreadySaid.text)
        #expect(options.map(\.text).contains(reply))
    }

    @Test func repliesUseTheUsersOwnReasonsAndStreak() {
        var texts: [String] = []
        for seed in 0..<4 {
            for intent in CoachIntent.allCases {
                texts += ScriptedCoach.replies(for: intent, context: Self.sampleContext, seed: seed).map(\.text)
            }
        }
        let joined = texts.joined(separator: "\n")
        #expect(joined.contains("Breathe easier on my runs"))
        #expect(joined.contains("Save for a trip to Japan"))
        #expect(joined.contains("Smoking"))
    }

    @Test func asyncReplyMatchesPureResponse() async {
        let coach = ScriptedCoach()
        let expected = coach.response(to: "I'm stressed", history: [], context: Self.sampleContext)
        let reply = await coach.reply(to: "I'm stressed", history: [], context: Self.sampleContext)
        #expect(reply == expected)
        #expect(!coach.usesOnDeviceModel)
    }

    @Test func openingMessageIsPersonalized() {
        let opening = ScriptedCoach.openingMessage(for: Self.sampleContext)
        #expect(opening.contains("Smoking"))
        #expect(opening.contains("12"))

        var fresh = Self.sampleContext
        fresh.currentStreak = 120
        #expect(ScriptedCoach.openingMessage(for: fresh).contains("Smoking"))

        #expect(!ScriptedCoach.openingMessage(for: Self.genericContext).isEmpty)
    }

    // MARK: Safety

    @Test func detectsCrisisMessages() {
        let messages = [
            "I want to kill myself",
            "I've been thinking about suicide",
            "Honestly I feel suicidal",
            "I don't want to live anymore",
            "I dont want to live",
            "I want to end my life",
            "I keep wanting to hurt myself",
            "thinking about self-harm again",
            "I might overdose tonight",
            "I'm in danger",
            "Everyone would be better off dead without me",
            "I WANT TO DIE",
            "I want to hang myself",
            "I don't want to wake up tomorrow",
        ]
        for message in messages {
            #expect(CoachSafety.isCrisis(message), "“\(message)” should be treated as a crisis")
        }
    }

    @Test func ordinaryCravingTalkIsNotACrisis() {
        let messages = [
            "I'm dying for a cigarette",
            "This craving is killing me",
            "I want to diet",
            "I want to take my life back from vaping",
            "My streak is in danger",
            "Kill this craving",
            "I'm stressed",
            "I slipped",
            "",
        ]
        for message in messages {
            #expect(!CoachSafety.isCrisis(message), "“\(message)” shouldn't be treated as a crisis")
        }
    }

    @Test func crisisGetsTheFixedSupportiveReply() {
        let coach = ScriptedCoach()
        let reply = coach.response(to: "I want to end it all", history: [], context: Self.sampleContext)
        #expect(reply == CoachSafety.crisisReply)
        #expect(reply.contains("findahelpline.com"))
        #expect(CoachSafety.helplineURL?.absoluteString == "https://findahelpline.com")
    }

    @Test func modelInstructionsCarryContextAndSafetyRules() {
        let history = (0..<10).map { index in
            CoachMessage(role: index.isMultiple(of: 2) ? .coach : .user, text: "Message \(index)")
        }
        let instructions = CoachPrompt.instructions(context: Self.sampleContext, history: history)
        #expect(instructions.contains("Smoking"))
        #expect(instructions.contains("Breathe easier on my runs"))
        #expect(instructions.contains("findahelpline.com"))
        #expect(instructions.contains("Message 9"))
        #expect(!instructions.contains("Message 3"))

        let generic = CoachPrompt.instructions(context: Self.genericContext, history: [])
        #expect(!generic.contains("Conversation so far"))
        #expect(CoachPrompt.truncated(String(repeating: "a", count: 500), to: 10).count == 11)
    }

    @Test func providerMatchesDeviceCapability() {
        let coach = CoachProvider.makeCoach()
        #expect(coach.usesOnDeviceModel == CoachProvider.isOnDeviceAIAvailable)
    }

    // MARK: Context

    @Test func contextPicksTheLongestCurrentStreak() {
        let container = AppModelContainer.make(inMemory: true)
        let modelContext = ModelContext(container)
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let day = Self.day

        let sugar = Habit(name: "Sugar", emoji: "🍭", theme: .candy, streakStart: now.addingTimeInterval(-2 * day), sortIndex: 0)
        // Lots of banked time, but the current streak is what counts.
        sugar.bankedSeconds = 200 * day
        let smoking = Habit(
            name: "Smoking", emoji: "🚬", theme: .fire,
            streakStart: now.addingTimeInterval(-12 * day),
            dailyCost: 10,
            reasons: ["Breathe easier", "   "],
            sortIndex: 1
        )
        let vaping = Habit(name: "Vaping", emoji: "💨", theme: .grape, streakStart: now.addingTimeInterval(-5 * day), sortIndex: 2)
        for habit in [sugar, smoking, vaping] {
            modelContext.insert(habit)
        }

        let context = CoachContext.make(habit: nil, allHabits: [sugar, smoking, vaping], now: now, currencyCode: "EUR")
        #expect(context.habitName == "Smoking")
        #expect(context.habitEmoji == "🚬")
        #expect(abs(context.currentStreak - 12 * day) < 0.001)
        #expect(context.reasons == ["Breathe easier"])
        #expect(abs(context.moneySaved - 120) < 0.001)
        #expect(context.currencyCode == "EUR")
        #expect(!context.isGeneric)
    }

    @Test func contextUsesTheGivenHabitAndItsTriggers() {
        let container = AppModelContainer.make(inMemory: true)
        let modelContext = ModelContext(container)
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let day = Self.day

        let short = Habit(name: "Sugar", emoji: "🍭", theme: .candy, streakStart: now.addingTimeInterval(-day))
        let long = Habit(name: "Smoking", emoji: "🚬", theme: .fire, streakStart: now.addingTimeInterval(-30 * day))
        modelContext.insert(short)
        modelContext.insert(long)

        let logged: [(CravingTrigger, Bool)] = [
            (.stress, true), (.stress, true), (.stress, true), (.boredom, true),
            (.other, true), (.other, true), (.other, true), (.other, true), (.social, false),
        ]
        for (trigger, resisted) in logged {
            let urge = Urge(date: now, resisted: resisted, trigger: trigger)
            modelContext.insert(urge)
            short.urges.append(urge)
        }

        let context = CoachContext.make(habit: short, allHabits: [short, long], now: now, currencyCode: "USD")
        #expect(context.habitName == "Sugar")
        #expect(context.topTrigger == .stress)
        #expect(context.cravingsBeaten == 8)
    }

    @Test func contextIsGenericWithoutHabits() {
        let context = CoachContext.make(habit: nil, allHabits: [], currencyCode: "USD")
        #expect(context.isGeneric)
        #expect(context.habitName == nil)
        #expect(context.currentStreak == 0)
        #expect(context.reasons.isEmpty)
        #expect(context.topTrigger == nil)
        #expect(context.cravingsBeaten == 0)
        #expect(context.moneySavedText == nil)
        #expect(!context.hasMeaningfulStreak)
    }

    @Test func mostCommonTriggerIgnoresOtherAndBreaksTiesInOrder() {
        #expect(CoachContext.mostCommonTrigger([]) == nil)
        #expect(CoachContext.mostCommonTrigger([nil, .other, .other]) == nil)
        #expect(CoachContext.mostCommonTrigger([.social, .tired, .tired, nil]) == .tired)
        // Equal counts: the trigger listed first in CravingTrigger wins.
        #expect(CoachContext.mostCommonTrigger([.social, .stress]) == .stress)
    }

    @Test func contextSanitizesBadNumbers() {
        let context = CoachContext(habitName: "Sugar", currentStreak: .nan, moneySaved: -Double.infinity, cravingsBeaten: -3)
        #expect(context.currentStreak == 0)
        #expect(context.moneySaved == 0)
        #expect(context.cravingsBeaten == 0)
        #expect(!context.streakText.isEmpty)
    }
}
