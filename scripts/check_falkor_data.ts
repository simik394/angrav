
import { getFalkorClient } from '../../shared/src/falkor-client';

async function main() {
    console.log('🔍 Checking FalkorDB Data...');
    const falkor = getFalkorClient();

    try {
        // 1. Check Sessions
        const sessions = await falkor.listSessions();
        console.log(`Found ${sessions.length} sessions in DB.`);
        
        if (sessions.length > 0) {
            console.log('Top 5 Sessions:');
            sessions.slice(0, 5).forEach((s: any) => console.log(`  - ${s.name} (${s.id}) [${s.status}]`));
            
            // 2. Check Interactions for the first session
            const firstId = sessions[0].id;
            console.log(`\nChecking interactions for session: ${sessions[0].name} (${firstId})...`);
            
            const interactions = await falkor.getInteractions(firstId, 100);
            console.log(`Found ${interactions.length} interactions.`);
            
            if (interactions.length > 0) {
                console.log('Sample Interaction:');
                console.log(interactions[0]);
            } else {
                console.log('⚠️ No interactions found in DB for this session.');
                
                // Check GLOBAL interactions count just in case
                const result = await falkor.query('MATCH (i:Interaction) RETURN count(i)');
                console.log(`\nTotal Interactions in entire DB: ${result[0]['count(i)']}`);
            }
        }

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await falkor.close();
    }
}

main();
